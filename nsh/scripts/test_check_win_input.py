import contextlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw

import check_win_input


class InputPixelTests(unittest.TestCase):
    def screenshots(self, folder, blank=False, selection=True, leaked=False):
        value = Image.new("RGB", (800, 640), "white")
        draw = ImageDraw.Draw(value)
        draw.rectangle((40, 35, 240, 49), fill="black")
        for top in (76, 128, 180):
            draw.rounded_rectangle((40, top, 460, top + 36), 4,
                                   outline=check_win_input.BORDER, width=2)
        if not blank:
            draw.rectangle((50, 85, 250, 99), fill="black")
        if leaked:
            draw.rectangle((50, 116, 100, 119), fill="black")
        value.save(folder / "win-input-1.0-value.png")
        selected = value.copy()
        if selection:
            ImageDraw.Draw(selected).rectangle((50, 83, 250, 105), fill="blue")
        selected.save(folder / "win-input-1.0-selected.png")
        return value

    def check(self, **options):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            self.screenshots(folder, **options)
            with contextlib.chdir(folder), patch.object(sys, "argv", ["check_win_input"]):
                with contextlib.redirect_stdout(io.StringIO()):
                    check_win_input.main()

    def test_first_of_three_fields_has_its_own_bounds(self):
        with tempfile.TemporaryDirectory() as directory:
            value = self.screenshots(Path(directory))
            self.assertEqual(check_win_input.find_field(value), (40, 76, 461, 111))

    def test_visible_text_and_selection_pass(self):
        self.check()

    def test_blank_text_fails(self):
        with self.assertRaises(SystemExit):
            self.check(blank=True)

    def test_missing_selection_fails(self):
        with self.assertRaises(SystemExit):
            self.check(selection=False)

    def test_text_outside_field_fails(self):
        with self.assertRaises(SystemExit):
            self.check(leaked=True)


if __name__ == "__main__":
    unittest.main()
