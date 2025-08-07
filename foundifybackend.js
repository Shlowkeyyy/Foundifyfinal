const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3000;  // Default port, change it if needed

app.use(cors());
app.use(express.json());

// A simple route to confirm the server is running
app.get('/', (req, res) => {
  res.send('Server is running!');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
