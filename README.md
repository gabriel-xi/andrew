# Andrew · Workspace

Gestionale web per corsi, tutor, calendario, contratti, documenti e banca ore.

**Stack:** Node.js 22.16+, SQLite, JavaScript ES Modules, HTML, CSS. Nessuna dipendenza runtime esterna.

## Installazione e avvio

1. Installa Node.js 22.16 o superiore.
2. Configura la variabile di ambiente ANDREW_SETUP_KEY con una chiave casuale di almeno 20 caratteri. Non pubblicarla su Git.
3. Da terminale esegui: npm run check; npm test; npm start.
4. Apri http://127.0.0.1:58235 e registra il primo amministratore utilizzando la chiave configurata.

Per generare la chiave su Mac/Linux:
    export ANDREW_SETUP_KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"

Dati locali: ./data/andrew.sqlite. Puoi modificare il percorso impostando ANDREW_DATA_DIR.
Per l'utilizzo remoto è obbligatorio predisporre HTTPS e controlli di accesso adeguati.

## Funzionalità incluse

- Login/registrazione con password scrypt, token HttpOnly e ruoli admin/tutor.
- Dashboard con statistiche, calendario, corsi, tutor e report.
- CRUD per corsi, sessioni, contratti, movimenti di banca ore e documenti.
- Controllo sovrapposizione di docenti e tutor, calendari ufficiali per corso, fasi aula/stage, moduli e test finali.
- Import dei calendari XLSX/CSV con anteprima, controllo collisioni e verifica duplicati; modello scaricabile dalla pagina Calendario.
- Presenze e turni anche notturni con orario previsto/effettivo, pause, calcolo delta e riconciliazione automatica con il saldo ore.
- Registro crediti/debiti con saldo iniziale e report settimanali/mensili.
- Export Excel (.xlsx) multi-foglio e CSV; import Excel e CSV con anteprima e blocco duplicati.
- Snapshot SQLite riservato agli amministratori.
- Test automatici e CI GitHub Actions.
- Frontend responsive con pagine separate in public/ e JS modulari.

## Migrazione dei dati

Conserva una copia del vecchio database e dei documenti al di fuori di Git.

Anteprima non distruttiva:
    node src/migrate.js --source "/percorso/banca_ore.db" --dry-run

Importazione in un database nuovo e vuoto:
    node src/migrate.js --source "/percorso/banca_ore.db" --documents "/percorso/documents" --apply

Il tool non modifica il database originale. Gli allegati vengono copiati solo quando è indicata la cartella fisica.
I record non convertibili sono conservati in legacy_unmapped_records.
L'importazione di profili senza password hash valida non riutilizza PIN predefiniti deboli.

## Architettura

- Database/: schema SQLite
- Routes/: endpoint HTTP e middleware
- src/: business logic, accesso dati, import ed Excel
- public/: HTML, CSS, JavaScript
- tests/: test di integrazione e regressione
- docs/: architettura, sicurezza e migrazione

## Avvertenze e limiti

La nuova implementazione non rappresenta ancora un porting 1:1 di tutti i processi del gestionale storico.
Alcuni formati Excel non tabellari, report contabili specifici, gestioni presenze avanzate e notifiche SMTP
richiedono ulteriore migrazione e validazione con i dati reali. Non sostituire il sistema in produzione
senza completare il collaudo e verificare tutti i record non migrabili.

La repository originale è pubblica e contiene nella cronologia un database e log potenzialmente sensibili.
Sono esclusi dal nuovo branch, ma non dalla vecchia cronologia né da main. Valutare la messa in privato
e l'eventuale bonifica della cronologia, con un piano di backup.

Consultare docs/MIGRATION.md, docs/SECURITY.md e docs/ARCHITECTURE.md per i dettagli.
