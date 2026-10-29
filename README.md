# Unisic · Workspace

**Unisic** è un gestionale modulare per corsi, calendario, tutor, presenze, contratti, documenti e banca ore. Stack: Node.js 22.16+, SQLite, HTML/CSS/JavaScript.

## Come avviarlo su Mac

Da una cartella di progetto che contiene già dati reali, salva una copia completa di `data/` prima di aggiornare il codice.

```bash
node -v
npm test
./avvia_unisic.command
```

Il file `avvia_unisic.command` genera (solo al primo avvio) una chiave in `data/setup.key`, la mostra nel Terminale e apre il sito su **http://127.0.0.1:58235**. Se necessario: `chmod +x avvia_unisic.command`.

La chiave iniziale serve soltanto alla creazione del primo amministratore. Dopo il login, nella sidebar trovi **Impostazioni**.

## Dove si trovano i dati?

Unisic salva il database e i documenti **sul dispositivo dove gira il server**, non su GitHub:

| Contenuto | Percorso locale |
|---|---|
| Nuova installazione | `data/unisic.sqlite` |
| Installazione precedente Andrew | `data/andrew.sqlite`, utilizzato automaticamente se già esiste |
| Documenti caricati | `data/documents/` |
| Chiave del primo avvio | `data/setup.key` |
| Eventuali file transitori SQLite | `data/*.sqlite-wal`, `data/*.sqlite-shm` |
| Backup manuali | Download dall'interfaccia amministratore, nella cartella di download scelta dal browser |

Il percorso effettivo è visibile nella schermata **Impostazioni → Database** dall'amministratore. È possibile cambiare directory impostando la variabile `UNISIC_DATA_DIR`; per compatibilità rimane supportata anche `ANDREW_DATA_DIR`.

**Importante:** non cancellare `data/`. Non rinominare o spostare il database a server acceso. Esegui sempre una copia dell'intera cartella a server fermo prima di migrare.

## Preferenze personali

Nella pagina **Impostazioni** ogni utente può scegliere:

- Tema **chiaro**, **scuro**, oppure **automatico** secondo il dispositivo.
- Modalità compatta.
- Eliminazione del proprio account, previa conferma testuale e password.

Le preferenze sono registrate in SQLite e caricate dopo l'accesso, con una copia locale del tema per l'applicazione immediata.

## Configurazione amministrativa

L'amministratore può:

- Modificare nome/sottotitolo del workspace e tema predefinito.
- Consentire o disabilitare la registrazione pubblica e l'upload dei tutor.
- Creare account, modificarne nome/email/ruolo/stato, saldo iniziale e ore giornaliere.
- Azzerare password (temporanea visibile una sola volta), chiudere le sessioni attive ed eliminare account e dati personali.
- Visualizzare percorsi dati, contatori e storico delle operazioni amministrative.
- Salvare un backup SQLite dal pannello amministratore.
- Eliminare **tutti** gli utenti e tutti i dati applicativi mediante l'operazione separata **Elimina tutto**, con password e doppia conferma.
- Gestire corsi, sessioni, documenti, contratti e altre informazioni dalle rispettive schermate.

Per evitare di rendere impossibile l'accesso, non è consentito eliminare l'ultimo amministratore attraverso la semplice cancellazione dell'account. Il ripristino totale torna invece alla configurazione iniziale.

**Le eliminazioni sono irreversibili e non cancellano i backup già scaricati né la cronologia Git.** Proteggi sempre i backup e i file di dati.

## Avvio manuale

```bash
export UNISIC_SETUP_KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
npm run check
npm test
npm start
```

Il server resta per impostazione predefinita su `127.0.0.1`. Per accesso remoto servono HTTPS, backup cifrati e controlli di sicurezza aggiuntivi.

## Migrazione del database originale Python/Bottle

```bash
node src/migrate.js --source "/percorso/banca_ore.db" --dry-run
node src/migrate.js --source "/percorso/banca_ore.db" --documents "/percorso/documents" --apply
```

La migrazione richiede una destinazione vuota; il database sorgente viene letto senza modifiche. Consulta `docs/MIGRATION.md`.

## Codice e test

- `Database/`: schema SQLite e upgrade idempotenti
- `Routes/`: API, autorizzazione e gestione admin
- `src/`: database, domini, import/export, settings
- `public/`: HTML, CSS e JavaScript per pagina
- `tests/`: integrazione HTTP, migrazione, gestione utenti, permessi e cancellazioni
- `.github/workflows/`: GitHub Actions CI

**Stato:** i test automatici verificano i principali percorsi, ma prima di usare Unisic con dati reali occorre comunque un collaudo operativo completo. La repository storica pubblica contiene database/log potenzialmente riservati nelle versioni precedenti: i file non vengono rimossi dalla cronologia solo aggiornando il branch.
