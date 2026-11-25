import { Notice, SecretComponent, Setting } from "obsidian";
import type AgenticChatPlugin from "../main";
import { DEFAULT_PHOTOS } from "./client";
export function renderPhotoSettings(container: HTMLElement, plugin: AgenticChatPlugin): void {
  new Setting(container).setName("COS 按需照片").setHeading();
  container.createEl("p", { text: "默认不上传。仅本地知识库模式可申请保存，每次须选择照片并确认。服务器正式目录、TLS/CORS 和开关待单独授权启用；当前测试版不代表真实云端已验收。每张最多 2 MiB，每批最多 4 张。" });
  new Setting(container).setName("启用照片服务客户端").setDesc("开启仅允许加载照片和发起批准申请，不授予自动上传权限。不改变服务器开关。").addToggle(t => t.setValue(plugin.settings.photos.enabled).onChange(async value => {
    if (plugin.photos?.active) { t.setValue(plugin.settings.photos.enabled); new Notice("照片任务正在批准或执行，请先完成或取消"); return; }
    plugin.settings.photos.enabled = value; plugin.photos?.changed(); await plugin.saveSettings();
  }));
  new Setting(container).setName("照片 HTTPS 授权接口").setDesc(DEFAULT_PHOTOS.endpoint + " · 仅允许此接口及固定广州私有 Bucket、private-photos/v1/ 正式前缀。拒绝隔离测试目录、HTTP 和跳转。");
  const storage = (plugin.app as unknown as { secretStorage?: { getSecret?: unknown } }).secretStorage;
  if (typeof storage?.getSecret === "function") {
    new Setting(container).setName("照片服务独立 Token").setDesc("使用 Obsidian SecretStorage；插件设置仅保存凭据名称。每台设备分别配置，不将 Token 写入笔记或同步。不要填写 COS SecretId/SecretKey。").addComponent(el => new SecretComponent(plugin.app, el).setValue(plugin.settings.photos.tokenSecretId).onChange(async id => {
      if (plugin.photos?.active) { new Notice("照片任务执行中，凭据名称未更改"); return; }
      plugin.settings.photos.tokenSecretId = id || DEFAULT_PHOTOS.tokenSecretId; plugin.photos?.changed(); await plugin.saveSettings();
    }));
  } else {
    new Setting(container).setName("仅本次会话 Token").setDesc("此 Obsidian 版本没有凭据存储 API，不能安全持久化。仅内存保存，重启失效；建议升级。其他插件与本机进程仍可能访问应用内存。").addText(t => { t.inputEl.type = "password"; t.inputEl.autocomplete = "off"; t.onChange(value => { if (!plugin.photos?.active) plugin.photos?.setSessionToken(value); }); });
  }
  new Setting(container).setName("私有照片显示缓存").setDesc("只在内存：最多 24 MiB，闲置 5 分钟回收，卸载释放；不写 Vault、不经 Syncthing。清理后图片可手动重试加载。").addButton(b => b.setButtonText("清理显示缓存").onClick(() => { plugin.photos?.cache.clear(); new Notice("照片显示缓存已清理"); }));
}
