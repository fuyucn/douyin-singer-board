package main

import "github.com/nsgo-dev/nsgo/updater"

func (board *boardState) checkUpdate() {
	if !board.updatesEnabled {
		board.notify("此版本未启用自动升级")
		return
	}
	if board.listenerCancel != nil || board.auto || board.busy {
		board.notify("请先停止监听和自动同步，并等待当前操作完成")
		return
	}
	updater.Check(board.scope)
}
