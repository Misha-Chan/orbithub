const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Handle all routes - serve the 403 page
app.get('*', (req, res) => {
    res.status(403).sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`403 Forbidden page running on http://localhost:${PORT}`);
});
