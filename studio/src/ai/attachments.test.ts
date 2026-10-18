// @vitest-environment jsdom
import { expect, it } from "vitest";
import { readAttachment, validateAttachments } from "./attachments";

it("reads UTF-8 RTL as explicit attached content", async () => {
  expect(await readAttachment(new File(["module top; endmodule"], "top.sv"))).toEqual({kind:"text",name:"top.sv",text:"module top; endmodule"});
});
it("sniffs PNG bytes rather than trusting the supplied MIME type", async () => {
  const file = new File([new Uint8Array([137,80,78,71,13,10,26,10])], "board.png", { type:"text/plain" });
  const value = await readAttachment(file);
  expect(value.kind).toBe("image");
  if (value.kind === "image") expect(value.dataUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
});
it("rejects sensitive names, binaries, invalid images and oversized inputs", async () => {
  for (const name of [".env", ".env.txt", "credentials.json", "private.pem", "archive.zip", "board.png"]) {
    await expect(readAttachment(new File(["not an image"], name))).rejects.toThrow();
  }
  await expect(readAttachment(new File([new Uint8Array([255])], "bad.txt"))).rejects.toThrow("UTF-8");
  await expect(readAttachment(new File(["a\0b"], "bad.txt"))).rejects.toThrow("binary");
  await expect(readAttachment(new File(["x".repeat(128*1024+1)], "big.sv"))).rejects.toThrow("128 KB");
});
it("bounds combined payloads and attachment count", () => {
  expect(() => validateAttachments(Array.from({length:7},()=>({kind:"text" as const,name:"top.sv",text:"module top; endmodule"})))).toThrow("6 files");
  expect(() => validateAttachments([{kind:"image",name:"board.png",dataUrl:"x".repeat(8*1024*1024)}])).toThrow("8 MB");
});
