const mongoose = require('mongoose');
const User = mongoose.model('User');

const backupRijeci = ["PROGRAMIRANJE", "REKVIZIT", "ARENA", "TEHNOLOGIJA", "SERVER", "ZLATNIK", "POBJEDA"];
let trenutnaRijec = "";
let prikazRijeci = [];
let lokalnaBazaRijeci = [];

async function ucitajBazuRijeci() {
    try {
        console.log("⏳ Pokušaj preuzimanja rječnika...");
        // Koristimo https:// umjesto raw github ako je bilo problema s CORS-om ili fetchom
        const url = 'https://raw.githubusercontent.com/com-li-re/croatian-dictionary/master/dictionary.txt';
        
        const response = await fetch(url);
        if (!response.ok) throw new Error("Mrežna greška");
        
        const podaci = await response.text();
        const linije = podaci.split(/\r?\n/); // Podržava oba tipa novog reda
        
        lokalnaBazaRijeci = linije
            .map(w => w.trim().toUpperCase())
            .filter(w => w.length > 4 && w.length < 12 && /^[A-ZČĆŽŠĐ]+$/.test(w));

        if (lokalnaBazaRijeci.length > 0) {
            console.log(`✅ GitHub rječnik uspješno učitan (${lokalnaBazaRijeci.length} riječi).`);
        } else {
            console.log("⚠️ Rječnik je prazan nakon filtriranja, koristim backup.");
            lokalnaBazaRijeci = backupRijeci;
        }
    } catch (e) {
        console.log("⚠️ Greška pri skidanju rječnika:", e.message);
        lokalnaBazaRijeci = backupRijeci;
    }
}

async function novaRunda(io) {
    if (lokalnaBazaRijeci.length === 0) await ucitajBazuRijeci();
    
    // Garantujemo da uvijek imamo riječ
    const index = Math.floor(Math.random() * lokalnaBazaRijeci.length);
    trenutnaRijec = lokalnaBazaRijeci[index] || "ARENA";
    
    prikazRijeci = trenutnaRijec.split('').map(() => "_");
    io.emit('vjesala-nova-runda', { prikaz: prikazRijeci.join(' ') });
}

async function inicijalizirajVjesala(io) {
    await ucitajBazuRijeci();
    novaRunda(io);

    io.on('connection', (socket) => {
        socket.on('vjesala-trazi-stanje', () => {
            socket.emit('vjesala-nova-runda', { prikaz: prikazRijeci.join(' ') });
        });

        socket.on('vjesala-pokusaj', async (data) => {
            if (!socket.username || !trenutnaRijec) return;
            const pokusaj = data.input.toUpperCase().trim();
            const user = await User.findOne({ username: socket.username });
            
            if (!user.stats) user.stats = {};
            if (!user.stats.vjesala) user.stats.vjesala = { level: 0, solved: 0 };

            let pogodak = false;
            if (pokusaj === trenutnaRijec) {
                prikazRijeci = trenutnaRijec.split('');
                pogodak = true;
            } else if (pokusaj.length === 1 && trenutnaRijec.includes(pokusaj)) {
                trenutnaRijec.split('').forEach((s, i) => { if(s === pokusaj) prikazRijeci[i] = s; });
                pogodak = true;
            }

            if (pogodak) {
                if (!prikazRijeci.includes("_")) {
                    user.stats.vjesala.solved += 1;
                    // Formula 2^level
                    let granica = Math.pow(2, user.stats.vjesala.level);
                    if (user.stats.vjesala.solved >= granica) {
                        user.stats.vjesala.level += 1;
                    }
                    user.markModified('stats');
                    await user.save();
                    
                    io.emit('vjesala-poruka', { 
                        text: `🎉 <b>${socket.username}</b> je pogodio riječ!`, 
                        stats: user.stats.vjesala 
                    });
                    setTimeout(() => novaRunda(io), 3000);
                } else {
                    io.emit('vjesala-update', { prikaz: prikazRijeci.join(' '), user: socket.username });
                }
            }
        });
    });
}

module.exports = { inicijalizirajVjesala };