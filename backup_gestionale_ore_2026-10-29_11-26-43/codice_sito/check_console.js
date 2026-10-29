const http = require('http');
const { spawn } = require('child_process');

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new',
  '--remote-debugging-port=9225',
  '--no-sandbox',
  '--disable-gpu',
  'about:blank'
]);

setTimeout(() => {
  http.get('http://127.0.0.1:9225/json', (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', () => {
      try {
        const pages = JSON.parse(raw);
        const page = pages[0];
        console.log("Connecting to:", page.webSocketDebuggerUrl);

        const ws = new WebSocket(page.webSocketDebuggerUrl);
        ws.addEventListener('open', () => {
          ws.send(JSON.stringify({ id: 1, method: "Log.enable" }));
          ws.send(JSON.stringify({ id: 2, method: "Runtime.enable" }));
          ws.send(JSON.stringify({ id: 3, method: "Page.enable" }));
          ws.send(JSON.stringify({
            id: 4,
            method: "Page.navigate",
            params: { url: "http://localhost:58235/" }
          }));
        });

        ws.addEventListener('message', (event) => {
          const data = JSON.parse(event.data);
          if (data.id === 50) {
            console.log("STEP 1 (set storage & reload):", data.result);
            ws.send(JSON.stringify({ id: 51, method: "Page.reload" }));
          }
          if (data.id === 60) {
            console.log("FINAL EVAL RESULT:", data.result);
          }
          if (data.method === "Runtime.exceptionThrown") {
            console.error("\n💥 RUNTIME EXCEPTION:", JSON.stringify(data.params.exceptionDetails, null, 2));
          } else if (data.method === "Runtime.consoleAPICalled") {
            console.log("CONSOLE:", data.params.type, data.params.args.map(a => a.value || a.description));
          }
        });

        // After initial load, set localStorage with Andrea's session and reload!
        setTimeout(() => {
          ws.send(JSON.stringify({
            id: 50,
            method: "Runtime.evaluate",
            params: {
              expression: `
                localStorage.setItem("bt_user_session", JSON.stringify({ id: 26, name: "Andrea Guardone", role: "admin", is_tutor: 1 }));
                localStorage.setItem("bt_auth_token", "test");
              `
            }
          }));
        }, 1500);

        // After reload, evaluate what DOM is shown!
        setTimeout(() => {
          ws.send(JSON.stringify({
            id: 60,
            method: "Runtime.evaluate",
            params: {
              expression: `JSON.stringify({
                authLoading: document.getElementById('authLoadingPlaceholder')?.style.display,
                authContainer: document.getElementById('authScreenContainer')?.style.display,
                loginCard: document.getElementById('authLoginCard')?.style.display,
                mainApp: document.getElementById('app')?.style.display,
                activeTab: document.querySelector('.tab-btn.active')?.dataset?.tab
              })`
            }
          }));
        }, 3500);

        setTimeout(() => {
          ws.close();
          chrome.kill();
          process.exit(0);
        }, 5000);
      } catch (err) {
        console.error("Error:", err);
        chrome.kill();
        process.exit(1);
      }
    });
  }).on('error', (err) => {
    console.error("HTTP error:", err);
    chrome.kill();
    process.exit(1);
  });
}, 1500);
