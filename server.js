require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

mongoose.connect(process.env.MONGO_URI).then(() => console.log("Arena Server Online ✅"));

const UserSchema = new mongoose.Schema({
    nadimak: { type: String, unique: true },
    lozinka: String,
    tajna_sifra: { type: String, default: "" },
    bodovi: { type: Number, default: 0 },         
    coinsi: { type: Number, default: 1000 },
    ciscoBodovi: { type: Number, default: 0 },
    avatar: { type: String, default: 'https://i.imgur.com/6VBx3io.png' }
});
const User = mongoose.model('User', UserSchema);

app.use(express.static('.'));

const pitanjaBaza = [
    { p: "Koji uređaj spaja različite mreže?", o: "Router", kat: "Cisco" },
    { p: "Koji tip memorije se koristi za Cache?", o: "SRAM", kat: "Hardware" },
    { p: "Na kojem portu radi HTTP?", o: "80", kat: "Network" },
    { p: "Što kratica LLM znači u AI?", o: "Large Language Model", kat: "AI" }
];

let onlineKorisnici = {};
let aktivniDueli = {};

io.on('connection', (socket) => {
    socket.on('provjeri_korisnika', async (data) => {
        let u = await User.findOne({ nadimak: data.nadimak });
        if (!u) { socket.emit('novi_igrac_registracija'); } 
        else if (u.lozinka === data.lozinka) { prijaviIgraca(u, socket); }
        else { socket.emit('greska', "Pogrešna lozinka!"); }
    });

    socket.on('registruj_novog', async (data) => {
        try {
            let u = new User({ nadimak: data.nadimak, lozinka: data.lozinka, tajna_sifra: data.tajna_sifra });
            await u.save();
            prijaviIgraca(u, socket);
        } catch(e) { socket.emit('greska', "Nadimak zauzet!"); }
    });

    async function prijaviIgraca(u, socket) {
        socket.nadimak = u.nadimak;
        onlineKorisnici[socket.id] = { id: socket.id, nadimak: u.nadimak, bodovi: u.bodovi };
        socket.emit('prijavljen', u);
        io.emit('osvezi_listu', Object.values(onlineKorisnici));
        const top = await User.find().sort({ bodovi: -1 }).limit(10);
        socket.emit('leaderboard', top);
    }

    // --- 1VS1 LOGIKA ---
    socket.on('izazovi_igraca', (targetId) => {
        if (onlineKorisnici[targetId]) {
            io.to(targetId).emit('dobio_izazov', { odKoga: socket.nadimak, odId: socket.id });
        }
    });

    socket.on('prihvati_izazov', (data) => {
        const room = `room_${data.odId}_${socket.id}`;
        socket.join(room);
        io.sockets.sockets.get(data.odId)?.join(room);
        
        const pitanje = pitanjaBaza[Math.floor(Math.random() * pitanjaBaza.length)];
        aktivniDueli[room] = { pitanje: pitanje, igraci: [data.odId, socket.id] };

        io.to(room).emit('start_duel', { pitanje: pitanje.p, protivnik: socket.nadimak });
    });

    socket.on('slanje_odgovora', async (data) => {
        let u = await User.findOne({ nadimak: socket.nadimak });
        let jeDuel = data.room && aktivniDueli[data.room];

        const pitanje = jeDuel ? aktivniDueli[data.room].pitanje : { o: "Pariz" }; // Primjer za global

        if (data.odgovor.toLowerCase() === pitanje.o.toLowerCase()) {
            u.bodovi += 50; u.coinsi += 50;
            if (jeDuel) {
                io.to(data.room).emit('duel_gotov', { pobjednik: socket.nadimak });
                delete aktivniDueli[data.room];
            } else {
                socket.emit('greska', "Točno! +50 bodova.");
            }
        } else {
            u.bodovi = Math.max(0, u.bodovi - 2); // KAZNA -2
            socket.emit('greska', "Netočno! -2 boda.");
        }
        await u.save();
        socket.emit('update_stats', u);
    });

    socket.on('chat_global', (msg) => {
        io.emit('chat_msg', { od: socket.nadimak, tekst: msg });
    });

    socket.on('disconnect', () => {
        delete onlineKorisnici[socket.id];
        io.emit('osvezi_listu', Object.values(onlineKorisnici));
    });
});

server.listen(10000);