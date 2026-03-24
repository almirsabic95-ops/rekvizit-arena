const mongoose = require('mongoose');
const User = mongoose.model('User');

const backupRijeci = ["PROGRAMIRANJE", "REKVIZIT", "ARENA", "TEHNOLOGIJA", "SERVER", "ZLATNIK", "POBJEDA"];
let trenutnaRijec = "";
let prikazRijeci = [];
let pogodjenaSlova = [];
let lokalnaBazaRijeci = [];

async function ucitajBazuRijeci() {
    try {
        const res = await fetch('https://raw.githubusercontent.com/com-li-re/croatian-dictionary/master/dictionary.txt');
        const podaci = await res.text();
        lokalnaBazaRijeci = podaci.split('\n')
            .map(w => w.trim().toUpperCase())
            .filter(w => w.length > 4 && w.length < 12 && /^[A-ZČĆŽŠĐ]+$/.test(w));
        console.log(`✅ GitHub rječnik učitan (${lokalnaBazaRijeci.length} riječi).`);
    } catch (e) {
        console.log("⚠️ GitHub Error, koristim backup.");
        lokalnaBazaRijeci = backupRijeci;
    }
}

async function novaRunda(io) {
    if (lokalnaBazaRijeci.length === 0) await ucitajBazuRijeci();
    const izvor = lokalnaBazaRijeci.length > 0 ? lokalnaBazaRijeci : backupRijeci;
    trenutnaRijec = izvor[Math.floor(Math.random() * izvor.length)];
    prikazRijeci = trenutnaRijec.split('').map(() => "_");
    pogodjenaSlova = [];
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
            if (!socket.username) return;
            const pokusaj = data.input.toUpperCase().trim();
            const user = await User.findOne({ username: socket.username });
            if (!user) return;

            if (pokusaj.length > 1) {
                if (pokusaj === trenutnaRijec) {
                    user.coins += 10;
                    await user.save();
                    io.emit('vjesala-poruka', { text: `🎉 <b>${socket.username}</b> je pogodio riječ: <b>${trenutnaRijec}</b>! (+10 R)` });
                    setTimeout(() => novaRunda(io), 4000);
                } else {
                    socket.emit('vjesala-poruka', { text: `❌ Riječ "${pokusaj}" nije točna!` });
                }
                return;
            }

            if (trenutnaRijec.includes(pokusaj)) {
                if (!pogodjenaSlova.includes(pokusaj)) {
                    pogodjenaSlova.push(pokusaj);
                    trenutnaRijec.split('').forEach((slovo, i) => {
                        if (slovo === pokusaj) prikazRijeci[i] = pokusaj;
                    });
                    user.coins += 1;
                    await user.save();
                    io.emit('vjesala-update', { prikaz: prikazRijeci.join(' '), user: socket.username, slovo: pokusaj });
                    if (!prikazRijeci.includes("_")) {
                        io.emit('vjesala-poruka', { text: `🎊 Riječ kompletirana!` });
                        setTimeout(() => novaRunda(io), 4000);
                    }
                }
            } else {
                socket.emit('vjesala-poruka', { text: `❌ Slovo "${pokusaj}" ne postoji.` });
            }
        });
    });
}

module.exports = { inicijalizirajVjesala };