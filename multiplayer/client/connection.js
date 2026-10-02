/** WebSocket 传输层只负责连接和重发，不自行决定房间阶段。 */
import {PROTOCOL_VERSION} from '../shared/rules.js';
export function endpoint(host, port, secure) {
  const value = host.trim();
  if (!value || /[\s/?#@]/.test(value) || !/^\d+$/.test(String(port)) || +port < 1 || +port > 65535) throw Error('请输入有效 IP/主机名与端口');
  const name = value.includes(':') && !value.startsWith('[') ? `[${value}]` : value;
  return `${secure ? 'wss' : 'ws'}://${name}:${port}/socket`;
}
export class Connection {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage; this.onStatus = onStatus; this.ws = null; this.retry = null; this.stopped = false;
    this.credentials = null; this.url = ''; this.hello = null; this.attempt = 0;
  }
  async connect(url, hello) {
    this.stopped = false; this.url = url; this.hello = hello;
    this.open();
  }
  open() {
    this.onStatus('连接中');
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.attempt = 0;
      this.send({type: 'hello', protocol: PROTOCOL_VERSION, ...this.hello, ...(this.credentials || {})});
    };
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.type === 'welcome') {
        this.credentials = {roomId: message.roomId, resumeToken: message.resumeToken};
        sessionStorage.setItem('garrison-online-connection-v1', JSON.stringify({url: this.url, hello: this.hello, credentials: this.credentials}));
        this.onStatus('已连接');
      }
      if (message.type === 'left') this.stop();
      this.onMessage(message);
    };
    this.ws.onclose = event => {
      if (this.stopped) return;
      this.onStatus('连接中断，正在重连');
      // 同一页面继续保留本地会话；重连后由房间阶段与 taskId 校准，重复结果可安全重发。
      if (this.credentials && event.code !== 4001) this.retry = setTimeout(() => this.open(), Math.min(5000, 500 * 2 ** this.attempt++));
      else this.onStatus(event.code === 4001 ? '已在另一窗口连接' : '连接失败');
    };
    this.ws.onerror = () => this.onStatus('连接失败，请检查地址与服务端');
  }
  send(message) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    if (this.ws.bufferedAmount > 2 * 1024 * 1024 && message.type === 'snapshot') return false;
    this.ws.send(JSON.stringify(message)); return true;
  }
  stop() {
    this.stopped = true; clearTimeout(this.retry); this.ws?.close(); this.credentials = null;
    sessionStorage.removeItem('garrison-online-connection-v1'); this.onStatus('尚未连接');
  }
}
