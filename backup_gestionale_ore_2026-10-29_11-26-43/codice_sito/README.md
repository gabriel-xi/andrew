# ⏱️ Banca del Tempo & Straordinari Dipendenti

Applicazione web moderna per la gestione dello storico delle giornate lavorative, il monitoraggio delle ore maturate (straordinari) e delle ore a debito (permessi/recuperi), conforme ai modelli contabili e ai cruscotti dei file Excel precedenti (*"Analisi File e Nuovo Documento"* e *"Ottimizzazione Tabella Ore E Straordinari"*).

---

## 🌟 Funzionalità Principali

1. **Gestione Ruoli & Primo Accesso (Admin vs Tutor)**:
   - **Andrea** è configurato come **👑 Amministratore (Admin)** con pieni poteri: gestione calendari corsi ufficiali, risoluzione sovrapposizioni docenti, aggiunta/modifica sessioni e dipendenti.
   - I collaboratori accedono come **🎓 Tutor**: inseriscono il proprio calendario e le proprie ore di tutoraggio, visualizzano i calendari ufficiali dei corsi e monitorano il monte ore.
   - Finestra di onboarding e selezione profilo rapida al primo accesso.

2. **🏛️ Calendari Corsi Ufficiali (Gestione Admin & Vista Tutor)**:
   - **Data d'inizio** e **data di fine ipotetica** del corso.
   - **Fase Aula**: giornate con orari di inizio e fine, **Docente** esterno assegnato e **Modulo** formativo.
   - **Fase Stage**: ha inizio al termine dell'aula, ha un proprio calendario ma **senza docenti e senza moduli didattici**, supervisionata dall'assigned **Tutor d'aula**.
   - Prospetto riepilogativo per corso con monte ore complessivo, scomposizione ore aula vs ore stage e stato sessioni.

3. **⚠️ Sistema di Prevenzione Sovrapposizioni Docenti (Anti-Collisione)**:
   - **Controllo automatico in tempo reale**: se un docente ha lezione in un corso nella fascia mattutina o pomeridiana (es. dalle 8:30 alle 13:30), non può avere lezione nello stesso giorno e negli stessi orari in un altro corso.
   - Rilevamento di **sovrapposizioni totali o parziali** prima dello svolgimento delle lezioni.
   - **Banner di allerta globale** in evidenza con elenco delle collisioni tra corsi.
   - Filtro rapido `"⚠️ Conflitti Docente"` e navigazione con evidenziazione immediata della sessione in conflitto.
   - Controllo preventivo istantaneo durante l'inserimento o la modifica di una lezione.

4. **🔄 Variazioni Lezioni: Rinvia o Annulla**:
   - Possibilità per l'Admin di **Rinviare** una lezione: indicazione della motivazione, proposta di nuova data e nuovi orari, con verifica live automatica della disponibilità del docente sul nuovo intervallo.
   - Possibilità di **Annullare** una lezione: la lezione viene contrassegnata come annullata senza bloccare il docente in altre aule.

5. **📅 Settimana in Corso, Orari & Uscite Anticipate / Posticipate**:
   - Visualizzazione settimanale dinamica con navigazione avanti/indietro.
   - Orario programmato vs orario effettivo di entrata/uscita con calcolo automatico della discrepanza (+ straordinario maturato o - debito utilizzato).

6. **📚 I Miei Corsi (Monte Ore Stabilito)**:
   - Corsi di cui il dipendente è tutor con monte ore assegnato, ore erogate e ore rimanenti da svolgere.

7. **📊 Cruscotto Saldo Ore & Banca (Fedele al foglio Excel)**:
   - **Totale Ore Accreditate / Iniziali** (es. `124,00 h` monte ore pregresso).
   - **Ore Straordinari Svolte (+)** (Celle Verdi, es. `+85,00 h`).
   - **Ore Utilizzate / Debito (-)** (Celle Gialle, es. `-73,00 h`).
   - **ORE RIMANENTI** in grande risalto con saldo progressivo (es. `51,00 h` derivato da $124 - 73$).
   - **Indicatori di Conversione Ferie**:
     - Giorni di ferie pagati su giornata standard da 7 ore (`7,29 gg`).
     - Giorni di ferie pagati su giornata breve da 4 ore (`12,75 gg`).
     - Settimane lavorative part-time su base 18 ore (`2,83 sett.`).
   - **Grafico a Ciambella / Donut Interattivo**.
   - **Prospetto Mensile di Dettaglio**.

8. **🗓️ Vista Calendario Mensile & Registro Movimenti**:
   - Disposizione ordinata a blocchi mensili a 4 colonne con colori ufficiali: **Giallo per debito/permessi**, **Verde per straordinari**.
   - Registro storico con ricerca, filtri e saldo progressivo.

9. **Sincronizzazione Excel (.xlsx) e CSV**:
   - **Esporta in Excel (.xlsx)**: genera un file a 3 fogli identico alla struttura di `File banca del tempo Andrea.xlsx` (*Riepilogo & Dashboard*, *Registro Movimenti*, *Vista Calendario Mensile*).
   - **Importa da Excel (.xlsx)**: carica file Excel per sincronizzare le registrazioni.
   - **Esporta in CSV**: compatibilità universale.

---

## 🚀 Come Avviare il Sito

### Su macOS:
1. Fai doppio clic sul file presente sulla tua Scrivania:  
   👉 **`Apri Sito Gestione Ore.command`**  
   *(oppure avvia `start_sito_mac.command` nella cartella del progetto).*
2. Il browser si aprirà automaticamente all'indirizzo **`http://127.0.0.1:58234`**.

### Su Windows:
1. Fai doppio clic sul file:  
   👉 **`avvia_sito_windows.bat`**
2. Si aprirà automaticamente il browser (Edge, Chrome, ecc.).

### Da Terminale (qualsiasi sistema):
```bash
python avvia_sito.py
```

---

## 🌐 Accesso da Rete Locale (Intranet Aziendale)
Se desideri che tutti i dipendenti dell'ufficio possano collegarsi contemporaneamente dai loro computer (Mac o Windows), tablet o smartphone:
Nel file `server.py`, imposta `host="0.0.0.0"`. I colleghi potranno accedere inserendo nel browser l'indirizzo IP locale del tuo computer (es. `http://192.168.1.50:58234`).
