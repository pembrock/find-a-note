from pathlib import Path


app = Path(defines["app"])
files = [str(app)]
symlinks = {"Applications": "/Applications"}
format = "UDZO"
filesystem = "HFS+"

background = defines["background"]
window_rect = ((140, 130), (600, 360))
default_view = "icon-view"
icon_size = 96
text_size = 14
label_pos = "bottom"
show_toolbar = False
show_sidebar = False
show_status_bar = False
show_pathbar = False
show_tab_view = False
icon_locations = {app.name: (172, 170), "Applications": (428, 170)}
