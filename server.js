require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

mongoose.connect(process.env.MONGO_URI).then(() => console.log("Cisco & AI Arena Spremna ✅"));

const UserSchema = new mongoose.Schema({
    nadimak: { type: String, unique: true },
    lozinka: String,
    tajna_sifra: { type: String, default: "" },
    bodovi: { type: Number, default: 0 },         
    coinsi: { type: Number, default: 1000 },
    ciscoBodovi: { type: Number, default: 0 }, 
    vauceri: { type: Number, default: 10 },
    avatar: { type: String, default: 'https://i.imgur.com/6VBx3io.png' }
});
const User = mongoose.model('User', UserSchema);

app.use(express.static('.'));

// --- MASOVNA BAZA PITANJA PO TEČAJEVIMA ---
const pitanjaBaza = [
    // MODERN AI & GEN AI
    { p: "Što kratica LLM znači u svijetu umjetne inteligencije?", o: "Large Language Model", kat: "AI" },
    { p: "Kako se naziva proces 'učenja' AI modela na velikim skupovima podataka?", o: "Trening", kat: "AI" },
    { p: "Koji tip AI-a stvara novi sadržaj poput slika ili teksta?", o: "Generativni AI", kat: "GenAI" },
    { p: "Kako se zove upit koji šaljemo Generativnom AI-u?", o: "Prompt", kat: "GenAI" },
    // CISCO PACKET TRACER
    { p: "Koji mod u Packet Traceru omogućuje promatranje putovanja paketa korak po korak?", o: "Simulation", kat: "PacketTracer" },
    { p: "Koji kabel koristimo za direktno spajanje dva PC-a bez switcha?", o: "Crossover", kat: "PacketTracer" },
    { p: "Ekstenzija datoteke spremljene u Cisco Packet Traceru je?", o: "PKT", kat: "PacketTracer" },
    // SUSTAINABILITY & IT
    { p: "Kako se naziva praksa smanjenja ekološkog otiska u IT sektoru?", o: "Green IT", kat: "Održivost" },
    { p: "Koji termin opisuje kružni ciklus ponovne uporabe IT opreme?", o: "Recikliranje", kat: "Održivost" },
    // OS & HARDWARE (Computer/Mobile Devices)
    { p: "Koji je najpopularniji operacijski sustav otvorenog koda za mobilne uređaje?", o: "Android", kat: "Mobile" },
    { p: "Što je 'Safe Mode' u operacijskim sustavima?", o: "Siguran način rada", kat: "OS" },
    { p: "Kratica za ekran osjetljiv na dodir je?", o: "Touchscreen", kat: "Mobile" },
    // DIGITAL AWARENESS & REPORTS
    { p: "Kako se naziva neželjena elektronička pošta koja često sadrži viruse?", o: "Spam", kat: "Digital" },
    { p: "Koji vizualni element najbolje prikazuje trendove u izvještajima?", o: "Grafikon", kat: "Izvještaji" },
    { p: "Što znači kratica PDF?", o: "Portable Document Format", kat: "Izvještaji" },
    // NETWORK BASICS (Ponavljanje i proširenje)
    { p: "Koja je MAC adresa duga (broj bita)?", o: "48", kat: "Network" },
    { p: "Koji protokol se koristi za prijenos datoteka?", o: "FTP", kat: "Network" },
    { p: "Koji uređaj spaja različite mreže?", o: "Router", kat: "Network" }
];

let trenutnoPitanje = null;

function novoPitanje() {
    trenutnoPitanje = pitanjaBaza[Math.floor(Math.random() * pitanjaBaza.length)];
    io.emit('novo_pitanje', { tekst: trenutnoPitanje.p, kategorija: trenutnoPitanje.kat });
}
setInterval(novoPitanje, 20000); // Brži tempo za Blanco vježbu

io.on('connection', (socket) => {
    socket.on('provjeri_korisnika', async (data) => {
        let u = await User.findOne({ nadimak: data.nadimak });
        if (!u) { 
            socket.emit('novi_igrac_registracija'); 
        } else if (u.lozinka === data.lozinka) { 
            socket.nadimak = u.nadimak; 
            socket.emit('prijavljen', u); 
            if(trenutnoPitanje) socket.emit('novo_pitanje', { tekst: trenutnoPitanje.p, kategorija: trenutnoPitanje.kat }); 
        } else { 
            socket.emit('greska', "Pogrešna lozinka!"); 
        }
    });

    socket.on('registruj_novog', async (data) => {
        try {
            let u = new User({ nadimak: data.nadimak, lozinka: data.lozinka, tajna_sifra: data.tajna_sifra });
            await u.save();
            socket.nadimak = u.nadimak; socket.emit('prijavljen', u);
        } catch(e) { socket.emit('greska', "Nadimak zauzet!"); }
    });

    socket.on('slanje_odgovora', async (data) => {
        if (trenutnoPitanje && data.odgovor.toLowerCase() === trenutnoPitanje.o.toLowerCase()) {
            let u = await User.findOne({ nadimak: socket.nadimak });
            
            // Svi tečajevi idu u Cisco Bodove (izolirano od coinsa po želji)
            u.ciscoBodovi += 50;
            await u.save();
            
            socket.emit('update_stats', { bodovi: u.bodovi, coinsi: u.coinsi, ciscoBodovi: u.ciscoBodovi });
            io.emit('chat_broadcast', { od: "SISTEM", tekst: `🎓 ${socket.nadimak} je riješio ${trenutnoPitanje.kat} pitanje!`, tip: 'global' });
            novoPitanje();
        }
    });

    socket.on('zavrti_kolo', async () => {
        let u = await User.findOne({ nadimak: socket.nadimak });
        const nagrade = [100, 200, 500, 1000, 150, 300, 5000, 50];
        const idx = Math.floor(Math.random() * nagrade.length);
        u.coinsi += nagrade[idx]; await u.save();
        socket.emit('kolo_rezultat', { index: idx, iznos: nagrade[idx], novoStanje: u.coinsi });
    });
});

server.listen(10000);