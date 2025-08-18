const WebSocketHandler = {
    WebSocket: "wss://ws.growagardenpro.com/",
    Socket: null,
    Data: {
      "weather": [],
      "gear": [],
      "seeds": [],
      "eggs": [],
      "events": [],
      "cosmetics": [],
      "TIMESTAMP": 0
    },
    // IgnoreCategories: ["weatherHistory", "honey", "TIMESTAMP"]
};

async function CreateWorker() {
    while(true) {
        try {
            await new Promise((resolve, reject) => {
                WebSocketHandler.Socket = new WebSocket(WebSocketHandler.WebSocket);

                WebSocketHandler.Socket.onopen = (EVENT) => {
                    console.log("WebSocket Connected.");
                    resolve();
                };

                WebSocketHandler.Socket.onmessage = (EVENT) => {
                    try {
                        const DATA = JSON.parse(EVENT.data);
                        if(DATA.type) {
                            if(WebSocketHandler.IgnoreCategories && WebSocketHandler.IgnoreCategories.includes(CATEGORY)) return;
                            Object.assign(WebSocketHandler.Data, DATA.data);
                            WebSocketHandler.Data.TIMESTAMP = Math.floor(Date.now() / 1000);

                            for(const CATEGORY in WebSocketHandler.Data) {
                              if(WebSocketHandler.IgnoreCategories && WebSocketHandler.IgnoreCategories.includes(CATEGORY)) continue;
                              WebSocketHandler.Data[CATEGORY] = DATA.data[CATEGORY] || [];
                              console.log(`Updated ${CATEGORY} data`, WebSocketHandler.Data[CATEGORY]);
                            }

                            console.log("Data updated", WebSocketHandler.Data);
                        }
                    } catch(parseError) {
                        console.error("Error parsing message:", parseError);
                    }
                };

                WebSocketHandler.Socket.onerror = (error) => {
                    console.error("WebSocket error:", error);
                    socket.close();
                    reject(error);
                };

                WebSocketHandler.Socket.onclose = (event) => {
                    console.log(`WebSocket connection closed: Code=${event.code}, Reason=${event.reason}`);
                    if (!event.wasClean) {
                        console.error("WebSocket connection died unexpectedly. Attempting reconnect...");

                        CreateWorker(); // Restart worker on unexpected close.
                    }
                };
            });

            await new Promise(resolve => {});
        } catch (e) {
            console.error(`WebSocket error: ${e}. Retrying in 5s...`);
            if (WebSocketHandler.Socket && WebSocketHandler.Socket.readyState !== WebSocket.CLOSED) {
                WebSocketHandler.Socket.close();
            }

            CreateWorker(); // Restart worker on error.
        }
    }
}

CreateWorker().catch(error => {
    console.error("Failed to create WebSocket worker:", error);
});