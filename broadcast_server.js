const express = require('express');
const { Bonjour } = require('bonjour-service');
const path = require('path');
const os = require('os');

const app = express();
const port = 8081;
const bonjour = new Bonjour();

// Get local IP address
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const localIp = getLocalIp();

// Serve static files from current directory
app.use(express.static(path.join(__dirname, '.')));

// Start server
app.listen(port, () => {
    console.log(`\n🚀 Server started at http://${localIp}:${port}`);
    console.log(`📂 Serving files from: ${__dirname}\n`);

    // Broadcast the service via mDNS
    const service = bonjour.publish({
        name: 'PMX Video DJ Server',
        type: 'pmx-dj',
        protocol: 'tcp',
        port: port,
        txt: {
            path: '/',
            version: '1.0.0'
        }
    });

    console.log(`📡 mDNS Service Broadcasted:`);
    console.log(`   Name: ${service.name}`);
    console.log(`   Type: _pmx-dj._tcp.local`);
    console.log(`   Port: ${service.port}`);
    console.log(`\nPress Ctrl+C to stop the server.\n`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Stopping server and unpublishing service...');
    bonjour.unpublishAll(() => {
        bonjour.destroy();
        process.exit();
    });
});
