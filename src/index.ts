import express from 'express';
// The strategy engine ships prebuilt (see tools/pack.js)
type Engine = { betRequest(gameState: unknown, cb: (bet: number) => void): void; showdown(gameState: unknown): void };
const { Player } = require('../dist/engine.js') as { Player: new () => Engine };

const VERSION = "bpex maniac 4.2 - shove-first aggro";

const app = express();
const player = new Player();


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', ({}, res) => res.status(200).send('OK'));

app.post('/', (req, res) => {
    if (req.body.action === 'bet_request') {
        player.betRequest(JSON.parse(req.body.game_state), bet => res.status(200).send(bet.toString()));
    } else if (req.body.action === 'showdown') {
        player.showdown(JSON.parse(req.body.game_state));
        res.status(200).send('OK');
    } else if (req.body.action === 'version') {
        res.status(200).send(VERSION);
    } else {
        res.status(200).send('OK');
    }
});

const port = parseInt(process.env['PORT'] || '1337');
const host = "0.0.0.0";
app.listen(port, host);
console.log('Listening at http://' + host + ':' + port);
