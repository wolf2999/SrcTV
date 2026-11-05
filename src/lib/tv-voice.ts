'use client';

/**
 * TV 语音输入桥（搜索输入增强，对应 M2「语音输入」方案）。
 *
 * 设计约束（对齐需求 §3.1 样式/逻辑隔离）：网页侧只关心「拿到一段识别文字」，
 * 不感知原生是否可用。原生 Android 侧用 SpeechRecognizer 识别后，通过 WebView
 * evaluateJavascript 派发 CustomEvent 到网页，本模块订阅即可。
 *
 * 可用性与失败场景全部通过返回值 / 状态事件暴露给 UI，UI 据此禁用麦克风或提示，
 * 不让原生异常穿透到网页渲染层。
 */

export type VoiceStatus = 'unavailable' | 'permission-denied' | 'error' | 'no-speech';

const RESULT_EVENT = 'srctv-voice-result';
const STATUS_EVENT = 'srctv-voice-status';

/** 原生桥接口；TV 壳会在 window.SrctvBridge 上挂这些方法 */
interface SrctvBridge {
  isVoiceAvailable?: () => boolean;
  startVoiceInput?: () => boolean;
}

function getBridge(): SrctvBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as { SrctvBridge?: SrctvBridge }).SrctvBridge;
}

/** 当前是否具备语音输入能力（原生桥存在 + 设备/壳声明可用）。false 时麦克风按钮应禁用 */
export function isVoiceAvailable(): boolean {
  const b = getBridge();
  return typeof b?.isVoiceAvailable === 'function' && b.isVoiceAvailable() === true;
}

/**
 * 发起一次语音识别。成功返回 true（识别结果会异步通过 srctv-voice-result 事件送达）；
 * 失败（无桥 / 设备不支持）返回 false，调用方可据此提示。
 */
export function startVoiceInput(): boolean {
  const b = getBridge();
  if (typeof b?.startVoiceInput === 'function') return b.startVoiceInput() === true;
  return false;
}

/** 订阅语音识别结果（detail 为识别出的文字）。返回取消订阅函数 */
export function onVoiceResult(cb: (text: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<string>).detail;
    if (typeof detail === 'string') cb(detail);
  };
  window.addEventListener(RESULT_EVENT, handler);
  return () => window.removeEventListener(RESULT_EVENT, handler);
}

/** 订阅语音状态通知（如权限被拒、无麦、无语音）。返回取消订阅函数 */
export function onVoiceStatus(cb: (status: VoiceStatus) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<VoiceStatus>).detail;
    if (detail) cb(detail);
  };
  window.addEventListener(STATUS_EVENT, handler);
  return () => window.removeEventListener(STATUS_EVENT, handler);
}
