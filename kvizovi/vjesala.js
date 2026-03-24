const mongoose = require('mongoose');

// Koristimo postojeći User model iz glavne aplikacije
const User = mongoose.model('User');

// Velika baza riječi za automatski kviz
const rijeci = ["PROGRAMIRANJE", "REKVIZIT", "ARENA", "TEHNOLOGIJA", "SERVER", "ZLATNIK", "POBJEDA", "MOBITEL", "KVORUM", "PLANINA", "GEOGRAFIJA", "SVEMIR", "ASTRONAUT", "PROCESOR", "INTERNET", "KORISNIK", "DATABASE", "OPERATIVNI", "SISTEM", "TASTOVATURA", "MONITOR", "LAPTOP", "EKRAN", "KABAL", "WIFI", "MREZA", "SIGURNOST", "HAKER", "LOGIKA", "ZADATAK"];

let trenutnaRijec = "";
let prikazRijeci = [];
let pogodjenaSlova = [];

function novaRunda(io) {
    trenutnaRijec = rijeci[Math.floor(Math.random() * rijeci.length)];
    prikazRijeci = trenutnaRijec.split('').map(() => "_");
    pogodjenaSlova = [];
    io.emit('vjesala-nova-runda', { prikaz: prikazRijeci.join(' ') });
}

function inicijalizirajVjesala(io) {
    // Pokreni prvu rundu odmah
    novaRunda(io);

    io.on('connection', (socket) => {
        // Kada novi igrač uđe, pošalji mu trenutno stanje riječi
        socket.on('vjesala-trazi-stanje', () => {
            socket.emit('vjesala-nova-runda', { prikaz: prikazRijeci.join(' ') });
        });

        socket.on('vjesala-pokusaj', async (data) => {
            if (!socket.username) return;
            const pokusaj = data.input.toUpperCase().trim();
            const user = await User.findOne({ username: socket.username });
            if (!user) return;

            // 1. POKUŠAJ CIJELE RIJEČI (Nagrada 10 R)
            if (pokusaj.length > 1) {
                if (pokusaj === trenutnaRijec) {
                    user.coins += 10;
                    await user.save();
                    io.emit('vjesala-poruka', { text: `🎉 ${socket.username} je pogodio riječ: <b>${trenutnaRijec}</b>! (+10 R)` });
                    setTimeout(() => novaRunda(io), 4000);
                } else {
                    socket.emit('vjesala-poruka', { text: `❌ Riječ "${pokusaj}" nije točna!` });
                }
                return;
            }

            // 2. POKUŠAJ JEDNOG SLOVA (Nagrada 1 R)
            if (trenutnaRijec.includes(pokusaj)) {
                if (!pogodjenaSlova.includes(pokusaj)) {
                    pogodjenaSlova.push(pokusaj);
                    
                    // Ažuriraj prikaz (pogodak na više mjesta odjednom)
                    trenutnaRijec.split('').forEach((slovo, i) => {
                        if (slovo === pokusaj) prikazRijeci[i] = pokusaj;
                    });

                    user.coins += 1;
                    await user.save();
                    io.emit('vjesala-update', { prikaz: prikazRijeci.join(' '), user: socket.username, slovo: pokusaj });

                    // Provjera je li cijela riječ otkrivena slovima
                    if (!prikazRijeci.includes("_")) {
                        io.emit('vjesala-poruka', { text: `🎊 Riječ je kompletirana! Nova runda uskoro...` });
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