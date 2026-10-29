# Andrew — gestionale modulare

Nuova implementazione Node.js 22.16+ / SQLite senza dipendenze runtime.

## Struttura
- Database/database.sql: schema SQLite
- Routes/: endpoint, middleware/auth.js
- src/: business logic, database, server
- public/: HTML, CSS/style.css, JS per pagina
- tests/: test automatici

## Avvio
Impostare la variabile ANDREW_SETUP_KEY a una stringa casuale lunga almeno 20 caratteri prima della registrazione iniziale dell'amministratore.
Da terminale: npm test, poi npm start. URL: http://127.0.0.1:58235.
Il database è creato in data/andrew.sqlite (ignorato da Git).
Per accesso remoto usare HTTPS e configurare un reverse proxy.

## Migrazione e limiti
Il gestionale legacy Python/Bottle rimane nell'archivio originale: NON viene sostituito né migrato automaticamente.
La nuova implementazione include login, registrazione, ruoli, corsi, calendari con collisioni, tutor e banca ore essenziale.
Non comprende ancora tutte le funzioni legacy (Excel, SMTP, documenti, contratti, import storico e workflow complessi).
Non usare in produzione senza migrazione validata, test e revisione di sicurezza.

## Privacy
Il vecchio backup include un database e log email già pubblicati nella storia Git. .gitignore non li cancella dalla storia.
Verificare eventuali dati personali e procedere con bonifica della cronologia e rotazione credenziali, previo backup autorizzato.