# Sicurezza e protezione dei dati

Server limitato a 127.0.0.1 di default. Per accesso remoto utilizzare un
reverse proxy HTTPS, protezioni contro i tentativi di accesso, backup cifrati e
policy di autenticazione aziendale appropriate.

Controlli: password scrypt, verifica password legacy PBKDF2, cookie HttpOnly con
SameSite=Strict, identificatori di sessione casuali memorizzati come hash,
query SQL parametrizzate, CSP e no frame, controllo degli accessi per ruoli,
limitazioni su upload, download e import, nessun dato utente in public/.

L'archivio originale su main contiene dati e log potenzialmente personali.
Eliminare file dal branch NON rimuove i dati dalla cronologia Git o da cloni già
esistenti. Decidere privacy repository, rotazione credenziali e bonifica storica
solo dopo aver verificato un backup recuperabile.

Prima dell'utilizzo in produzione: completare test di regressione sui dati reali,
analisi delle dipendenze, accessibilità, recupero dopo disastro e pen-test.
