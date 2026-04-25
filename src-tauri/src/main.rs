// 阻止 Windows release 构建弹出额外控制台
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sususingerboard_lib::run()
}
