const express = require('express');
const { exec } = require('child_process');
const app = express();
const PORT = 4000;

app.use(express.json());

app.post('/webhook', (req, res) => {
  console.log('Received webhook from GitHub');
  exec('~/auto-pull.sh', (err, stdout, stderr) => {
    if (err) {
      console.error('Git pull failed:', stderr);
      return res.status(500).send('Pull failed');
    }
    console.log('Git pull success:', stdout);
    res.sendStatus(200);
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Webhook server running on port ${PORT}`);
});
