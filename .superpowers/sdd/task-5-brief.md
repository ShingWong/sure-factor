### Task 5: sure-factor Auth Form Templates

**Files:**
- Create: `/usr/local/devel/sure-factor/catalog/components/auth-login.yaml`
- Create: `/usr/local/devel/sure-factor/catalog/components/auth-register.yaml`
- Create: `/usr/local/devel/sure-factor/catalog/components/auth-reset-password.yaml`

- [ ] **Step 1: Create auth-login.yaml**

```yaml
name: auth-login
description: Login form with email, password, OAuth provider buttons, and footer links
tier: prototype
parameters:
  fields:
    - name: email
      type: email
      required: true
    - name: password
      type: password
      required: true
  submitLabel:
    en: Sign In
    es: Iniciar Sesión
    fr: Connexion
  oauthProviders:
    - google
    - github
    - microsoft
  showRememberMe: true
  showForgotPassword: true
  showRegisterLink: true
behavior:
  notificationModes:
    - inline
    - toast
  audio:
    errorBell: false
    successChime: false
  voiceHelp: false
  autoFocus: true
scripts:
  - auth-handler.js
cssClasses:
  form: sure-auth__form
  header: sure-auth__header
  field: sure-auth__field
  label: sure-auth__label
  input: sure-auth__input
  inputError: sure-auth__input--error
  error: sure-auth__error
  help: sure-auth__help
  btn: sure-auth__btn
  btnSocial: sure-auth__btn--social
  divider: sure-auth__divider
  footer: sure-auth__footer
  alert: sure-auth__alert
example:
  usage: Generate a login form with email/password, "Sign in with Google" button, and "Don't have an account? Register" link
```

- [ ] **Step 2: Create auth-register.yaml**

```yaml
name: auth-register
description: Registration form with name, email, password, confirm password, terms checkbox
tier: prototype
parameters:
  fields:
    - name: fullName
      type: full-name
      required: true
    - name: email
      type: email
      required: true
    - name: password
      type: password
      required: true
    - name: confirmPassword
      type: password
      required: true
  submitLabel:
    en: Create Account
    es: Crear Cuenta
    fr: Créer un Compte
  showLoginLink: true
  requireTermsConsent: true
behavior:
  notificationModes:
    - inline
    - toast
  audio:
    errorBell: true
    successChime: true
  autoFocus: true
cssClasses:
  form: sure-auth__form
  header: sure-auth__header
  field: sure-auth__field
  label: sure-auth__label
  input: sure-auth__input
  inputError: sure-auth__input--error
  error: sure-auth__error
  help: sure-auth__help
  btn: sure-auth__btn
  footer: sure-auth__footer
  alert: sure-auth__alert
example:
  usage: Generate a registration form with name, email, password, confirm password, and terms acceptance
```

- [ ] **Step 3: Create auth-reset-password.yaml**

```yaml
name: auth-reset-password
description: Two-step password reset flow — email entry then new password
tier: prototype
parameters:
  step1Fields:
    - name: email
      type: email
      required: true
  step2Fields:
    - name: newPassword
      type: password
      required: true
    - name: confirmPassword
      type: password
      required: true
  submitLabel:
    en: Send Reset Link
    es: Enviar Enlace
    fr: Envoyer le Lien
  step2SubmitLabel:
    en: Reset Password
    es: Restablecer Contraseña
    fr: Réinitialiser le Mot de Passe
  showLoginLink: true
cssClasses:
  form: sure-auth__form
  header: sure-auth__header
  field: sure-auth__field
  label: sure-auth__label
  input: sure-auth__input
  inputError: sure-auth__input--error
  error: sure-auth__error
  help: sure-auth__help
  btn: sure-auth__btn
  footer: sure-auth__footer
  alert: sure-auth__alert
example:
  usage: Generate a password reset flow — enter email, then set new password
```

- [ ] **Step 4: Run tests**

```bash
cd /usr/local/devel/sure-factor && npm test 2>&1 | tail -5
```
Expected: All 132 tests pass (YAML parsing of new catalog entries).

- [ ] **Step 5: Commit**

```bash
cd /usr/local/devel/sure-factor && git add catalog/components/auth-*.yaml && git commit -m "feat: add auth form component templates (login, register, reset-password)"
```

---

