const fetch = require('node-fetch');
const fs = require('fs-extra');

// Mapa kategorija (ID-ovi sa Open Trivia DB)
const kategorijeMap = {
    "sport": 21,
    "povijest": 23,
    "znanost": 17,
    "film": 11,
    "zemljopis": 22,
    "kultura": 25,
    "glazba": 12
};

async function povuciPitanja() {
    console.log("Započinjem punjenje Arene pitanjima...");

    for (const [ime, id] of Object.entries(kategorijeMap)) {
        try {
            // Povlačimo 20 pitanja po kategoriji
            const url = `https://opentdb.com/api.php?amount=20&category=${id}&type=multiple`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.results) {
                const formatiranaPitanja = data.results.map(p => ({
                    pitanje: p.question.replace(/&quot;/g, '"').replace(/&#039;/g, "'"),
                    odgovor: p.correct_answer.replace(/&quot;/g, '"').replace(/&#039;/g, "'")
                }));

                const putanja = `./pitanja/${ime}.json`;
                await fs.writeJson(putanja, formatiranaPitanja, { spaces: 2 });
                console.log(`✅ Kategorija [${ime.toUpperCase()}] je napunjena!`);
            }
        } catch (error) {
            console.log(`❌ Greška kod kategorije ${ime}:`, error.message);
        }
    }
    console.log("\nSve datoteke su spremne u mapi /pitanja.");
}

povuciPitanja();