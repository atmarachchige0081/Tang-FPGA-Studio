import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Check, GitCompareArrows, X } from "lucide-react";
import { bridge } from "../lib/bridge";
import { fileName, languageForPath } from "../lib/language";
import { useWorkbench } from "../store/workbench";
import "../lib/monaco-loader";

/** Native journal snapshots, independent of provider messages and Git. */
export function ProjectChangeReview(): React.JSX.Element | null {
  const {root,projectPath,fileChanges,changeReviewOpen,changeReviewPath,changeTrackingLimited,theme,openChangeReview,closeChangeReview} = useWorkbench();
  const selected=fileChanges.find((change)=>change.path===changeReviewPath) ?? fileChanges[0];
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const dialog=useRef<HTMLElement | null>(null);
  const diff=useRef<import("monaco-editor").editor.IStandaloneDiffEditor | null>(null);
  useEffect(()=>{setError("");},[root,projectPath,selected?.path,changeReviewOpen]);
  // Detach models before the React Monaco wrapper disposes them. Monaco's
  // deferred diff computation otherwise observes disposed, still-attached models.
  useLayoutEffect(()=>()=>{
    const editor=diff.current;
    if(editor){
      const models=editor.getModel();
      editor.setModel(null);
      models?.original.dispose();
      models?.modified.dispose();
      diff.current=null;
    }
  },[root,projectPath,selected?.path,changeReviewOpen]);
  useEffect(()=>{
    if (!changeReviewOpen) return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const frame=requestAnimationFrame(()=>dialog.current?.querySelector<HTMLButtonElement>("button")?.focus());
    const close=(event:KeyboardEvent)=>{
      if(event.key==="Escape") {event.preventDefault();closeChangeReview();}
      if(event.key==="Tab") {
        const focusable=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),[tabindex="0"],textarea') ?? []).filter(element=>element.getClientRects().length);
        const first=focusable[0],last=focusable.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    window.addEventListener("keydown",close);return()=>{cancelAnimationFrame(frame);window.removeEventListener("keydown",close);previous?.focus();};
  },[changeReviewOpen,closeChangeReview]);
  const reviewed=async()=>{
    if(!selected||busy)return;
    const scope=`${root}/${projectPath}`;
    setBusy(true);setError("");
    try {
      await bridge.markChangeReviewed(root,projectPath,selected.path,selected.revision);
      const snapshot=await bridge.pollProjectChanges(root,projectPath);
      if(`${useWorkbench.getState().root}/${useWorkbench.getState().projectPath}`===scope && snapshot.changes) useWorkbench.getState().setFileChanges(snapshot.changes,snapshot.limited,snapshot.revision);
    }catch(reason){setError(String(reason));}finally{setBusy(false);}
  };
  if(!changeReviewOpen)return null;
  return <div className="change-review-overlay"><section ref={dialog} className="change-review" onKeyDown={(event)=>{if((event.ctrlKey||event.metaKey)&&["s","o","n","k"].includes(event.key.toLowerCase())) {event.preventDefault();event.stopPropagation();}}} role="dialog" aria-modal="true" aria-labelledby="change-review-title">
    <header><GitCompareArrows size={18}/><h2 id="change-review-title">File changes</h2><span>Before → current disk version</span><button aria-label="Close change review" onClick={closeChangeReview}><X size={18}/></button></header>
    <p className="change-review-context">Review saved changes from the assistant, terminal or another editor. The left side shows the version before the edits.</p>
    {changeTrackingLimited && <p className="change-review-warning">Some files exceed tracking limits (512 text files, 256 KiB per file, 8 MiB per project). Hidden and sensitive files are excluded.</p>}
    {error && <p role="alert" className="change-review-warning">{error}</p>}
    <div className="change-review-body"><nav aria-label="Changed files">{fileChanges.map((change)=><button title={change.path} className={change.path===selected?.path?"active":""} key={change.path} onClick={()=>openChangeReview(change.path)}><b className={`change-kind ${change.kind}`}>{change.kind==="added"?"A":change.kind==="deleted"?"D":"M"}</b><span><strong>{fileName(change.path)}</strong><small>{change.path}</small></span></button>)}{!fileChanges.length&&<p>No unreviewed changes.</p>}</nav>
      <main>{selected?<><div className="change-review-file"><code>{selected.path}</code><span>{selected.kind}</span><button title="Previous change" onClick={()=>diff.current?.goToDiff("previous")}>Previous</button><button title="Next change" onClick={()=>diff.current?.goToDiff("next")}>Next</button></div><div className="change-diff"><DiffEditor keepCurrentOriginalModel keepCurrentModifiedModel key={selected.path} original={selected.before} modified={selected.after} language={languageForPath(selected.path)} theme={theme==="light"?"light":"vs-dark"} onMount={(editor)=>{diff.current=editor;}} options={{readOnly:true,originalEditable:false,renderSideBySide:true,useInlineViewWhenSpaceIsLimited:true,automaticLayout:true,minimap:{enabled:false},fontFamily:"Consolas, 'Cascadia Code', monospace",fontSize:13,scrollBeyondLastLine:false,renderIndicators:true,diffCodeLens:false,maxComputationTime:2000,hideUnchangedRegions:{enabled:true,minimumLineCount:5,contextLineCount:3}}}/></div></>:<div className="change-review-empty">File changes will appear here while you work.</div>}</main>
    </div><footer><span>Marking reviewed clears the indicator. Source files stay unchanged.</span><button disabled={!selected||busy} className="secondary-button" onClick={()=>void reviewed()}><Check size={15}/> Mark file reviewed</button><button className="secondary-button" onClick={closeChangeReview}>Close</button></footer>
  </section></div>;
}
