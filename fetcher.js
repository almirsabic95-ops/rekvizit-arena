const { MongoClient } = require('mongodb');
const fs = require('fs-extra');

// 1. TVOJI PODACI (Zamijeni lozinku svojom lozinkom iz Atlasa)
const URI = "mongodb+srv://rekvizit:<db_arenakviz>@rekvizit.o6ugw5r.mongodb.net/?appName=Rekvizit";
const client = new MongoClient(URI);

const kategorije = [
    { id: 21, ime: 'sport' },
    { id: 22, ime: 'geografija' }
];

async function povuciPitanja() {
    try {
        console.log("🚀 Povezujem se na Rekvizit Cloud...");
        await client.connect();
        const db = client.db("KvizDB");
        const collection = db.collection("Pitanja");

        for (const { id, ime } of kategorije) {
            console.log(`📡 Povlačim pitanja za kategoriju: ${ime}...`);
            
            // Povlačimo 50 pitanja u Base64 formatu za maksimalnu stabilnost
            const url = `https://opentdb.com/api.php?amount=50&category=${id}&type=multiple&encode=base64`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.results && data.results.length > 0) {
                const formatiranaPitanja = data.results.map(p => {
                    // SIGURNO DEKODIRANJE (Rješava tvoj InvalidCharacter i URI malformed problem)
                    const dekodiraj = (str) => Buffer.from(str, 'base64').toString('utf8');

                    return {
                        pitanje: dekodiraj(p.question),
                        odgovor: dekodiraj(p.correct_answer),
                        netacni: p.incorrect_answers.map(odg => dekodiraj(odg)),
                        kategorija: ime,
                        datum_dodavanja: new Date()
                    };
                });

                // 2. SLANJE U CLOUD (MongoDB)
                // Prvo brišemo stara pitanja te kategorije (opcionalno) i ubacujemo nova
                await collection.deleteMany({ kategorija: ime });
                await collection.insertMany(formatiranaPitanja);

                // 3. LOKALNA REZERVA (Zadržavamo tvoj .json sistem za svaki slučaj)
                const putanja = `./pitanja/${ime}.json`;
                await fs.ensureDir('./pitanja');
                await fs.writeJson(putanja, formatiranaPitanja, { spaces: 2 });

                console.log(`✅ Kategorija [${ime}] uspješno osvježena u Cloudu i lokalno!`);
            }
        }
    } catch (e) {
        console.error("❌ Greška u radu:", e);
    } finally {
        await client.close();
        console.log("🔌 Veza sa bazom zatvorena.");
    }
}

povuciPitanja();