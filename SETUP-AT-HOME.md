# "work app" — ghar wale computer pe setup (2026-08-20, Turso version)

Ye "work app" (Office Dashboard) ki poori copy hai, Turso cloud database se connect hoti hai.
Jab Umair kahe **"work app setup karo"**, Claude ko ye poore steps khud follow karne chahiye —
sirf ek cheez hai jo Umair se poochni padegi (step 4, Turso token).

## Steps (agent, khud follow karo)

1. Confirm karo Python 3 installed hai (`python --version`). Nahi hai to Umair ko batao, khud
   install mat karo.
2. Is poore `work app` folder (jahan ye file hai) ko copy kar ke local (Drive se **bahar**)
   folder mein paste karo: `C:\Users\<is computer ka Windows username>\work app\`.
   **Wajah Drive se bahar rakhne ki:** andar jo `office_replica.db` banegi wo baar baar likhi
   jati hai — agar Drive-sync wale folder mein ho to sync corrupt kar sakta hai. `office.db`
   (is Drive copy ke andar) copy mat karo — purana/stale hai, ab kisi kaam ka nahi.
3. Zaroori packages install karo:
   ```
   pip install flask openpyxl libsql
   ```
4. **Sirf ye ek manual/security step hai:** Umair se Turso database ka URL + read-write token
   maango (wahi jo office computer ki `C:\Users\owais\OfficeDashboard\turso_config.py` mein
   hai) — is naye local `work app` folder mein khud ye file banao:
   ```python
   TURSO_URL = "<Umair se milega>"
   TURSO_AUTH_TOKEN = "<Umair se milega>"
   ```
   **Ye file kabhi Drive-synced folder mein copy na karo, kisi memory/note mein bhi nahi** —
   isme live database ka read-write access hai. Sirf is naye local `work app` folder mein rahegi.
5. App start karo: `python app.py` (usi local `work app` folder ke andar se), phir
   `http://127.0.0.1:8877/` browser mein khol kar confirm karo dashboard load ho raha hai aur
   client/task data dikh raha hai (agar Turso credentials sahi hain to turant dikh jayega — koi
   manual data copy nahi karni, sab paths ab khud-b-khud is computer ke sahi username/location
   se resolve hote hain).
6. Khud-b-khud startup ke liye: `launch_dashboard.vbs` ko is computer ke Startup folder mein
   copy karo (`shell:startup` Run box mein type karke khulta hai).
7. Umair ko confirm karo ke ho gaya, aur usay bata do ke office aur ghar dono computers ab
   **isi ek** Turso database ko share kar rahe hain — kahin bhi task add/update ho, dusri jagah
   turant dikhega.

## Important

- Paths ab hardcoded username pe depend nahi karte (`app.py`/`export_excel.py` khud
  `os.path.expanduser("~")` se apna Drive path nikaal lete hain) — is liye agar is computer ka
  Windows username "owais" nahi hai, tab bhi kaam karega, bashart Google Drive folder structure
  wahi ho (`My Drive\Owais\Online work\claude employee office tasks`).
- Turso hi ab dono computers ka shared live source of truth hai — is Drive folder ke andar ab
  koi live database file nahi hai (sirf ye starter-kit code, jo Drive se khud sync ho kar ghar
  pahunch jata hai).
- **Backup Now** button is computer se bhi chalega, aur `DB Backups` folder (Drive, cloud-backed)
  mein hi jama hoga — office wale backups ke sath.
