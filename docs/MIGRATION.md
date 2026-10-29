# Migrazione da Bottle / SQLite

Prima di procedere: crea backup coerente e non pubblico, verifica integrità SQLite,
ferma l'installazione legacy, imposta ANDREW_DATA_DIR verso una directory nuova.

1. node src/migrate.js --source "/percorso/banca_ore.db" --dry-run
2. Verifica i conteggi.
3. node src/migrate.js --source "/percorso/banca_ore.db" --documents "/percorso/documents" --apply
4. Verifica saldi e assegnazioni rispetto ai report legacy.
5. Apri docs/SECURITY.md prima di esporre in rete.

Mappatura: employees->users (hash PBKDF2 solo se valido, vecchi PIN disabilitati);
courses->courses; course_calendars e course_calendar_sessions->calendari/eventi;
work_entries maturata->credit, utilizzata->debit;
employee_contracts->employee_contracts; documents->documents se i file esistono.

I record non rappresentabili vanno in legacy_unmapped_records. La sorgente è
aperta in sola lettura. La destinazione deve essere vuota. Gli errori fanno
rollback della transazione SQLite, rimuovendo eventuali file copiati dal tool.

Checklist di accettazione: utenti, ruoli, saldi iniziali, ore maturate/usate,
corsi, tutor, date/sessioni, contratti, documenti, test, backup.
I record non convertiti devono essere risolti prima di dichiarare conclusa la migrazione.
