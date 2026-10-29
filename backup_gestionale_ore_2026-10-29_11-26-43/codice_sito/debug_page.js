const http = require('http');
const { spawn } = require('child_process');

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new',
  '--window-size=1280,800',
  '--remote-debugging-port=9226',
  '--no-sandbox',
  '--disable-gpu',
  'about:blank'
]);

setTimeout(() => {
  http.get('http://127.0.0.1:9226/json', (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', () => {
      try {
        const pages = JSON.parse(raw);
        const page = pages[0];
        const ws = new WebSocket(page.webSocketDebuggerUrl);

        ws.addEventListener('open', () => {
          ws.send(JSON.stringify({ id: 1, method: "Network.enable" }));
          ws.send(JSON.stringify({ id: 2, method: "Log.enable" }));
          ws.send(JSON.stringify({ id: 3, method: "Runtime.enable" }));
          ws.send(JSON.stringify({ id: 4, method: "Page.enable" }));
          ws.send(JSON.stringify({
            id: 5,
            method: "Emulation.setDeviceMetricsOverride",
            params: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }
          }));
          ws.send(JSON.stringify({ id: 6, method: "Page.navigate", params: { url: "http://localhost:58235/" } }));
        });

        ws.addEventListener('message', async (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id === 100) {
            console.log("🔥 EVAL RESULT:", msg.result.result.value);
            ws.send(JSON.stringify({
              id: 200,
              method: "Page.captureScreenshot",
              params: {
                clip: { x: 0, y: 0, width: 1280, height: 800, scale: 1 },
                captureBeyondViewport: false
              }
            }));
          }
          if (msg.id === 200) {
            const fs = require('fs');
            fs.writeFileSync('/Users/andrea/.gemini/antigravity/scratch/gestione_ore_v2/rendered_login.png', Buffer.from(msg.result.data, 'base64'));
            console.log("📸 Saved rendered_login.png!");
          }
          if (msg.method === "Network.requestWillBeSent") {
            console.log("-> REQUEST:", msg.params.request.url);
          } else if (msg.method === "Network.responseReceived") {
            console.log("<- RESPONSE:", msg.params.response.status, msg.params.response.url);
          } else if (msg.method === "Network.loadingFailed") {
            console.error("❌ FAILED:", msg.params.errorText, msg.params.type);
          } else if (msg.method === "Runtime.exceptionThrown") {
            console.error("\n💥 RUNTIME EXCEPTION:", JSON.stringify(msg.params.exceptionDetails, null, 2));
          } else if (msg.method === "Runtime.consoleAPICalled") {
            console.log("CONSOLE:", msg.params.type, msg.params.args.map(a => a.value || a.description));
          } else if (msg.method === "Page.domContentEventFired") {
            console.log("⚡ DOMContentLoaded FIRED!");
          } else if (msg.method === "Page.loadEventFired") {
            console.log("🏁 LoadEvent FIRED!");
          }
        });

        setTimeout(async () => {
          ws.send(JSON.stringify({
            id: 100,
            method: "Runtime.evaluate",
            params: {
              expression: `JSON.stringify({
                innerWidth: window.innerWidth,
                innerHeight: window.innerHeight,
                docClientWidth: document.documentElement.clientWidth,
                bodyClientWidth: document.body.clientWidth,
                authWrapperWidth: document.querySelector('.auth-wrapper')?.clientWidth,
                loginCardWidth: document.querySelector('.auth-card')?.clientWidth
              })`,
              returnByValue: true
            }
          }));
        }, 3000);

        setTimeout(() => {
          ws.close();
          chrome.kill();
          process.exit(0);
        }, 5000);

      } catch (err) {
        console.error(err);
        chrome.kill();
        process.exit(1);
      }
    });
  }).on('error', err => {
    console.error(err);
    chrome.kill();
    process.exit(1);
  });
}, 1500);
