from pathlib import Path
import unittest


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]


class WindowsToolLauncherTests(unittest.TestCase):
    def test_verilator_uses_native_windows_binary_and_explicit_data_root(self):
        script = (WORKSPACE_ROOT / "fpga.ps1").read_text(encoding="utf-8")
        self.assertIn("bin\\verilator_bin.exe", script)
        self.assertIn("$env:VERILATOR_ROOT = $verilatorRoot", script)
        self.assertIn("Invoke-NativeTool $script:VerilatorExecutable", script)
        self.assertNotIn("Invoke-NativeTool 'verilator'", script)
        self.assertNotIn("& verilator --version", script)

    def test_release_helpers_bypass_restricted_execution_policy(self):
        for name in (
            "release-check",
            "stress-test",
            "test-console-boards",
            "capture-screenshots",
        ):
            with self.subTest(name=name):
                wrapper = WORKSPACE_ROOT / "scripts" / f"{name}.cmd"
                content = wrapper.read_text(encoding="utf-8")
                self.assertIn("-ExecutionPolicy Bypass", content)
                self.assertIn(f"{name}.ps1", content)

    def test_absent_jtag_is_checked_before_generic_ftdi_access_failure(self):
        script = (WORKSPACE_ROOT / "fpga.ps1").read_text(encoding="utf-8")
        absent = script.index("device not found|no JTAG probe|no cable found")
        generic = script.index("unable to open ftdi device|usb_open")
        self.assertLess(absent, generic)
        self.assertIn("No JTAG programmer is currently visible", script)


if __name__ == "__main__":
    unittest.main()
