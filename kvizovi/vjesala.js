const mongoose = require('mongoose');

// Dohvaćamo model koji je već registriran u server.js
const User = mongoose.model('User');

const backupRijeci = ["PROGRAMIRANJE", "REKVIZIT", "ARENA", "TEHNOLOGIJA", "SERVER", "ZLATNIK", "POBJEDA"];
let trenutnaRijec = "";
let prikazRijeci = [];
let pogodjenaSlova = [];
let lokalnaBazaRijeci = [];

// Funkcija koja puni bazu iz hrvatskog rječnika (GitHub)
async function ucitajBazuRijeci() {
    try {
        const res = await fetch('https://raw.githubusercontent.com/com-li-re/croatian-dictionary/master/dictionary.txt');
        const podaci = await res.text();
        
        // Razdvajamo riječi, pretvaramo u velika slova i filtriramo
        lokalnaBazaRijeci = podaci.split('\n')
            .map(w => w.trim().toUpperCase())
            // Riječi od 5 do 11 slova, samo čista slova (bez brojeva/znakova)
            .filter(w => w.length > 4 && w.length < 12 && /^[A-ZČĆŽŠĐ]+$/.test(w));
        
        console.log(`📚 Učitano ${lokalnaBazaRijeci.length} hrvatskih riječi s GitHuba.`);
    } catch (e) {
        console.log("⚠️ Greška pri učitavanju rječnika, koristim backup listu.");
        lokalnaBazaRijeci = backupRijeci;
    }
}

async function novaRunda(io) {
    // Prvi put učitavamo bazu ako je prazna
    if (lokalnaBazaRijeci.length === 0) await ucitajBazuRijeci();
    
    // Ako učitavanje nije uspjelo, koristimo backup
    const izvor = lokalnaBazaRijeci.length > 0 ? lokalnaBazaRijeci : backupRijeci;
    
    trenutnaRijec = izvor[Math.floor(Math.random() * izvor.length)];
    prikazRijeci = trenutnaRijec.split('').map(() => "_");
    pogodjenaSlova = [];
    
    io.emit('vjesala-nova-runda', { prikaz: prikazRijeci.join(' ') });
    console.log(`🎮 Aktivna riječ: ${trenutnaRijec}`);
}

function inicijalizirajVjesala(io) {
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

            // 1. POGODAK CIJELE RIJEČI (+10 R)
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

            // 2. POGODAK SLOVA (+1 R)
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
                        io.emit('vjesala-poruka', { text: `🎊 Riječ je kompletirana! Sljedeća runda uskoro...` });
                        setTimeout(() => novaRunda(io), 4000);
                    }
                } else {
                    socket.emit('vjesala-poruka', { text: `⚠️ Slovo ${pokusaj} je već pogođeno.` });
                }
            } else {
                socket.emit('vjesala-poruka', { text: `❌ Slovo "${pokusaj}" se ne nalazi u ovoj riječi.` });
            }
        });
    });
}

module.exports = { inicijalizirajVjesala };