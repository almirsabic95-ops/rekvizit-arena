const mongoose = require('mongoose');
const User = mongoose.model('User');

const backupRijeci = ["PROGRAMIRANJE", "REKVIZIT", "ARENA", "TEHNOLOGIJA", "SERVER", "ZLATNIK", "POBJEDA"];
let trenutnaRijec = "";
let prikazRijeci = [];
let lokalnaBazaRijeci = [];

async function ucitajBazuRijeci() {
    try {
        console.log("⏳ Preuzimanje rječnika s GitHub-a...");
        const response = await fetch('https://raw.githubusercontent.com/com-li-re/croatian-dictionary/master/dictionary.txt');
        const text = await response.text();
        
        const filtrirane = text.split('\n')
            .map(w => w.trim().toUpperCase())
            .filter(w => w.length > 3 && w.length < 12 && /^[A-ZČĆŽŠĐ]+$/.test(w));
        
        if (filtrirane.length > 0) {
            lokalnaBazaRijeci = filtrirane;
            console.log(`✅ Rječnik spreman (${lokalnaBazaRijeci.length} riječi).`);
        } else {
            throw new Error("Prazan rječnik");
        }
    } catch (e) {
        console.log("⚠️ Greška rječnika ili nema interneta, koristim backup.");
        lokalnaBazaRijeci = backupRijeci;
    }
}

async function novaRunda(io) {
    if (lokalnaBazaRijeci.length === 0) await ucitajBazuRijeci();
    
    // Osiguranje da trenutnaRijec nikada ne bude undefined
    trenutnaRijec = lokalnaBazaRijeci[Math.floor(Math.random() * lokalnaBazaRijeci.length)] || "ARENA";
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
                    let granica = Math.pow(2, user.stats.vjesala.level);
                    if (user.stats.vjesala.solved >= granica) {
                        user.stats.vjesala.level += 1;
                    }
                    user.markModified('stats');
                    await user.save();
                    io.emit('vjesala-poruka', { 
                        text: `🎉 <b>${socket.username}</b> je pogodio!`, 
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