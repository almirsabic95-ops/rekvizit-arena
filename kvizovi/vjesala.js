const mongoose = require('mongoose');
const User = mongoose.model('User');

const backupRijeci = ["PROGRAMIRANJE", "REKVIZIT", "ARENA", "TEHNOLOGIJA", "SERVER", "POBJEDA"];
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
    } catch (e) {
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

            // AKO POGODI CIJELU RIJEČ
            if (pokusaj === trenutnaRijec) {
                user.solvedWords += 1; // Povećaj broj točnih riječi

                // LOGIKA LEVELIRANJA: Duplo više od prethodnog (2^level)
                // Level 0 -> treba 1 riječ za Lvl 1
                // Level 1 -> treba 2 riječi za Lvl 2
                // Level 2 -> treba 4 riječi za Lvl 3 itd.
                let potrebanBrojZaSjedeci = Math.pow(2, user.level);

                let levelUpPoruka = "";
                if (user.solvedWords >= potrebanBrojZaSjedeci) {
                    user.level += 1;
                    levelUpPoruka = ` 🆙 <b>LEVEL UP! Sada si Level ${user.level}!</b>`;
                }

                await user.save();
                io.emit('vjesala-poruka', { 
                    text: `🎉 <b>${socket.username}</b> je pogodio riječ: <b>${trenutnaRijec}</b>! (Ukupno pogođeno: ${user.solvedWords})${levelUpPoruka}` 
                });
                setTimeout(() => novaRunda(io), 4000);
                return;
            }

            // AKO POGODI SLOVO
            if (trenutnaRijec.includes(pokusaj) && pokusaj.length === 1) {
                if (!pogodjenaSlova.includes(pokusaj)) {
                    pogodjenaSlova.push(pokusaj);
                    trenutnaRijec.split('').forEach((slovo, i) => {
                        if (slovo === pokusaj) prikazRijeci[i] = pokusaj;
                    });
                    
                    io.emit('vjesala-update', { prikaz: prikazRijeci.join(' '), user: socket.username, slovo: pokusaj });
                    
                    if (!prikazRijeci.includes("_")) {
                        // Automatsko slanje "pogodio cijelu riječ" logike ako su sva slova tu
                        user.solvedWords += 1;
                        let potrebanBrojZaSjedeci = Math.pow(2, user.level);
                        if (user.solvedWords >= potrebanBrojZaSjedeci) user.level += 1;
                        await user.save();
                        
                        io.emit('vjesala-poruka', { text: `🎊 Riječ kompletirana! (Level: ${user.level})` });
                        setTimeout(() => novaRunda(io), 4000);
                    }
                }
            }
        });
    });
}

module.exports = { inicijalizirajVjesala };