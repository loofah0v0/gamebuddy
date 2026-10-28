# Third-party notices

## DeepSeek Harness

GameGuy uses DeepSeek Harness 0.2.1-rc.2 under MIT. The desktop browser-guests.mjs, keyboard.mjs and keybindings.mjs are adapted from deepseek-ai/deepseek-harness commit 687f282e8625c6b8d11ff58211a90524be2e4317; channels, trusted-document admission and product identity are changed for GameGuy. The preload directory-picker, file-path, fullscreen, theme and shortcut bridges also adapt the upstream desktop host contract. GameGuy composes the pinned native web profile/client modules inside its own Electron host with a GameGuy client extension. The upstream checkout is read-only and is not the product entry point.

```text
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

This notice is not a complete distribution license audit. MAA is AGPL; MuMu and official game assets/CLI redistribution require separate review.


## 2026-10-28 游戏市场适配

`D:/Gameguy/packages/agent-extensions` 从固定 DSH 0.2.1-rc.2 的 MIT 页面和 Typert 元数据生成产品适配文件，保留上游 LICENSE。龙虾杀游戏包从本机固定版本 @myclaw163/clawclaw-cli 0.9.1 的官方 Skill 生成，CLI 仍为本机精确依赖，不擅自宣称再分发授权。当前 tgz 仅本地测试产物；上线/公开分发前仍需核实官方 Skill/CLI 及所有依赖的授权。
