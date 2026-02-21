const express = require('express');
const app = express();
const path = require('path');
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname)); // Ovdje stavi index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/provjeri-datum', (req, res) => {
    const { datum } = req.body;
    // Ovdje upiši njen pravi datum rođenja u formatu GGGG-MM-DD
    const praviDatum = "1996-03-05"; // PROMIJENI OVO NA NJEN DATUM

    if (datum === praviDatum) {
        res.json({ success: true });
    } else {
        res.json({ success: false, message: "Pokušaj ponovno, ljubavi..." });
    }
});

app.listen(PORT, () => {
    console.log(`Server radi na portu ${PORT}. Rođendanska čestitka je spremna!`);
});