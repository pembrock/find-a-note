import runpy
import sys
from pathlib import Path

from ds_store import DSStore


volume, bundle, layout = map(Path, sys.argv[1:])
expected = runpy.run_path(str(layout), init_globals={
    "defines": {"app": str(bundle), "background": ""},
})
background = volume / ".background.tiff"
assert background.is_file() and background.stat().st_size > 0
visible = {item.name for item in volume.iterdir() if not item.name.startswith(".")}
assert visible == {bundle.name, "Applications"}, visible

with DSStore.open(str(volume / ".DS_Store"), "r") as store:
    window = store["."]["bwsp"]
    icons = store["."]["icvp"]
    assert icons["backgroundType"] == 2 and icons["backgroundImageAlias"]
    assert store["."]["pBBk"]
    assert icons["iconSize"] == expected["icon_size"]
    x, y = expected["window_rect"][0]
    width, height = expected["window_rect"][1]
    assert window["WindowBounds"] == f"{{{{{x}, {y}}}, {{{width}, {height}}}}}"
    for key in ("ShowToolbar", "ShowSidebar", "ShowStatusBar", "ShowPathbar", "ShowTabView"):
        assert not window[key], key
    for name, location in expected["icon_locations"].items():
        assert store[name]["Iloc"] == location, name

print("Verified Finder window, background bookmark, icon locations, and visible items")
