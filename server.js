const express = require('express');
const app = express();
const path = require('path');

app.use(express.json());
app.use(express.static('public')); // Ovdje stavi index.html

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

app.listen(3000, () => {
    console.log('Server radi na portu 3000. Rođendanska čestitka je spremna!');
});