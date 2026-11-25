import { Notice, Platform, Setting, requireApiVersion, type ToggleComponent } from "obsidian";
import type AgenticChatPlugin from "../main";
import { DEFAULT_PHOTOS } from "./client";

export function renderPhotoSettings(container: HTMLElement, plugin: AgenticChatPlugin): void {
  new Setting(container).setName("私有照片").setHeading();
  container.createEl("p", { text: "本地日记 + 私有 COS 原图。每张最多 10 MiB，每批最多 4 张、合计最多 40 MiB；每次逐张批准后上传，不压缩、不自动同步笔记。" });
  const storage = plugin.app.secretStorage;
  const secretId = plugin.photos?.deviceSecretId() || DEFAULT_PHOTOS.tokenSecretId;
  const status = container.createEl("p", { cls: "azhen-photo-device-status", text: storage?.getSecret(secretId)?.startsWith("azp_") ? "此设备已有独立照片凭据；Android 和 Windows 请各自配对。" : "此设备尚未连接正式照片服务，请输入一次性配对码。" });
  if (!requireApiVersion("1.11.5") || !storage?.setSecret) {
    status.setText("照片配对需要 Obsidian 1.11.5 或更新版本的本机加密凭据存储。升级 Obsidian 后即可连接设备。"); return;
  }
  let code = "";
  let name = Platform.isMobile ? "Android" : "Windows";
  let enabledToggle: ToggleComponent | undefined;
  new Setting(container).setName("设备名称").addText(t => t.setValue(name).onChange(value => { name = value; }));
  new Setting(container).setName("一次性配对码").setDesc("由照片服务管理员提供，10 分钟内有效、仅使用一次。在这里输入，不要发送到聊天；系统自动保存此设备独立凭据。").addText(t => {
    t.inputEl.type = "password"; t.inputEl.autocomplete = "off"; t.onChange(value => { code = value; });
  });
  new Setting(container).addButton(button => button.setButtonText("连接此设备").setCta().onClick(async () => {
    if (plugin.photos?.active) { new Notice("照片任务进行中，请完成后再连接设备"); return; }
    if (!/^[A-Z2-9]{16}$/.test(code.toUpperCase().replaceAll("-", "").trim()) || !name.trim() || name.length > 64) { new Notice("请输入有效配对码和设备名称"); return; }
    button.setDisabled(true);
    try {
      const token = await plugin.photos!.client.pair(code.toUpperCase().replaceAll("-", "").trim(), name.trim());
      if (plugin.photos!.active) throw new Error("photo_task_started_during_pairing");
      plugin.photos!.storeDeviceToken(token);
      plugin.photos!.setEnabled(true);
      enabledToggle?.setValue(true);
      code = ""; container.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(input => { input.value = ""; });
      status.setText("此设备已连接。以后打开本地笔记会自动加载配图；凭据仅存本机。"); new Notice("照片服务连接成功");
    } catch { status.setText("连接未成功：请核对配对码是否有效及照片服务是否已部署。不要粘贴凭据到聊天。"); }
    finally { button.setDisabled(false); }
  }));
  new Setting(container).setName("启用照片服务客户端").addToggle(t => { enabledToggle = t; t.setValue(plugin.photos?.enabled() ?? false).onChange(value => {
    if (plugin.photos?.active) { t.setValue(plugin.photos.enabled()); new Notice("请先完成或取消照片任务"); return; }
    plugin.photos?.setEnabled(value);
  }); });
  new Setting(container).addButton(b => b.setButtonText("为当前笔记选择照片").onClick(() => {
    const file = plugin.app.workspace.getActiveFile();
    if (file?.extension === "md") plugin.photos?.pickForNote(file.path);
    else new Notice("请先打开目标本地笔记，再使用侧栏照片按钮或命令面板");
  }));
  new Setting(container).setName("私有照片显示缓存").setDesc("原图字节缓存最多 40 MiB，闲置 5 分钟回收；打开笔记时按需申请新的读取授权，笔记只保存稳定 photoId。").addButton(b => b.setButtonText("清理显示缓存").onClick(() => plugin.photos?.cache.clear()));
  container.createEl("p", { text: `连接来源：${window.origin}；接口：${DEFAULT_PHOTOS.endpoint}` });
}
