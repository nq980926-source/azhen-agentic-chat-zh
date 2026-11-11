import { describe, it, expect, vi } from "vitest";
import { readLocalImage } from "../src/ui/local-images";
import { ChatView } from "../src/ui/chat-view";

describe("local image composer", () => {
  const file = (name: string, bytes: number[], size = bytes.length) => ({ name, size, arrayBuffer: async () => new Uint8Array(bytes).buffer }) as File;
  it.each([
    ["a.png", [137,80,78,71,13,10,26,10], "image/png"],
    ["a.jpg", [255,216,255,224], "image/jpeg"],
    ["a.gif", [...Buffer.from("GIF89a")], "image/gif"],
    ["a.webp", [...Buffer.from("RIFF1234WEBP")], "image/webp"],
  ])("encodes %s as actual ImageContent bytes", async (name, bytes, mime) => {
    const result = await readLocalImage(file(name as string, bytes as number[]));
    expect(result.mimeType).toBe(mime);
    expect(Buffer.from(result.data, "base64")).toEqual(Buffer.from(bytes as number[]));
  });
  it("rejects format, oversize, corrupt and read failures", async () => {
    await expect(readLocalImage(file("a.pdf", [1]))).rejects.toThrow("仅支持");
    await expect(readLocalImage(file("a.png", [1], 11*1024*1024))).rejects.toThrow("10 MB");
    await expect(readLocalImage(file("a.png", [1]))).rejects.toThrow("无效");
    await expect(readLocalImage({ name: "a.png", size: 5, arrayBuffer: async () => { throw Error(); } } as unknown as File)).rejects.toThrow("读取失败");
  });
  function harness(error?: string, vision = true) {
    const image = {name:"a.png", size:8, mimeType:"image/png", data:"iVBORw0KGgo="};
    let count = 0;
    const service = { isStreaming:()=>false, isTurnInFlight:()=>false, supportsImages:()=>vision,
      sendPrompt:vi.fn(async()=>{count++;}), getError:()=>error, getSessionToken:()=>"s", getMessages:()=>Array(count).fill({role:"user"}) };
    const tab = {service};
    // Prototype harness exercises the real private composer method.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view: any = Object.assign(Object.create(ChatView.prototype), {
      tabs:[tab], activeTabIndex:0, localImages:new WeakMap([[tab,[image]]]), imageSendBusy:false,
      promptEdit:{isEditing:false}, attachments:[], inputEl:{value:"说明"},
      preparePromptSend:vi.fn(async()=>({prompt:"说明",images:[],sessionToken:"s",messageCountBefore:0})),
      effectiveActiveNote:()=>null, isLiveTab:()=>true, clearComposer:vi.fn(), renderTranscript:vi.fn(), renderChips:vi.fn(),
    });
    return {view,service,tab,image};
  }
  it("sends text and real images together using the existing service", async()=>{
    const {view,service,tab,image}=harness();
    await view.sendLocalImages("说明");
    expect(service.sendPrompt).toHaveBeenCalledWith("说明",[{type:"image",data:image.data,mimeType:image.mimeType}],"s");
    expect(view.localImages.get(tab)).toEqual([]);
    expect(view.clearComposer).toHaveBeenCalledOnce();
  });
  it("retains image and text drafts on provider failure", async()=>{
    const {view,tab,image}=harness("network failed");
    await view.sendLocalImages("说明");
    expect(view.localImages.get(tab)).toEqual([image]);
    expect(view.clearComposer).not.toHaveBeenCalled();
  });
  it("blocks nonvision models without sending or losing drafts",async()=>{
    const {view,service,tab,image}=harness(undefined,false);
    await view.sendLocalImages("说明");
    expect(service.sendPrompt).not.toHaveBeenCalled();
    expect(view.localImages.get(tab)).toEqual([image]);
  });
});

import { preserveComposerKey } from "../src/ui/composer-input";
describe("native composer keyboard", () => {
  it.each([
    [true, "Enter", false, 13, true], [true, "Enter", false, 13, true],
    [false, "Enter", false, 13, false], [false, "Enter", true, 13, true],
    [false, "Enter", false, 229, true], [true, "a", true, 229, true],
    [false, "a", false, 65, false],
  ])("preserves mobile/IME keys %s %s %s %s", (mobile,key,isComposing,keyCode,expected)=>{
    expect(preserveComposerKey({key,isComposing,keyCode},mobile)).toBe(expected);
  });
});
