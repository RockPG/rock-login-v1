import { createClient } from '@supabase/supabase-js';
import pkg from './package.json';

/**
 * REUSABLE LOGIN CONFIGURATION
 */
const CONFIG = {
    appName: "Rock Team",
    appDescription: "Seu portal unificado de acesso a todas as ferramentas e soluções do ecossistema Rock Team.",
    copyright: `© ${new Date().getFullYear()} Login &bull; v${pkg.version}`,
    primaryColor: "#0084c2",
    secondaryColor: "#005a87",
    defaultAppId: 'rock-portal-v1'
};

// Global state to store the actual target app
let targetApp = {
    id: CONFIG.defaultAppId,
    name: CONFIG.appName,
    url: null
};

// Initialize Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function initializeApp() {
    // 1. Check if there's an 'app' parameter in the URL
    const urlParams = new URLSearchParams(window.location.search);
    const appIdFromUrl = urlParams.get('app');

    if (appIdFromUrl) {
        // 2. Fetch app meta-data from central_apps
        const { data: appData } = await supabase
            .from('central_apps')
            .select('name, url')
            .eq('id', appIdFromUrl)
            .single();

        if (appData) {
            targetApp.id = appIdFromUrl;
            targetApp.name = appData.name;
            targetApp.url = appData.url;

            // Allow dynamic redirect overrides for development/port flexibility
            const dynamicRedirect = urlParams.get('redirect');
            if (dynamicRedirect) {
                try {
                    const urlObj = new URL(dynamicRedirect);
                    targetApp.url = urlObj.toString();
                    console.log(`[Login] Overriding targetApp.url with dynamic redirect:`, targetApp.url);
                } catch (e) {
                    console.warn(`[Login] Invalid dynamic redirect URL:`, dynamicRedirect);
                }
            }

            // Update UI dynamically
            document.title = `Login | ${targetApp.name}`;
            document.getElementById('app-title').textContent = targetApp.name;
        }
    }

    // Apply baseline UI
    document.getElementById('app-description').textContent = CONFIG.appDescription;
    document.getElementById('copyright').textContent = CONFIG.copyright;
}

document.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();

    // Password Toggle Logic
    const togglePassword = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('password');

    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', () => {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            if (type === 'text') {
                togglePassword.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
            } else {
                togglePassword.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
            }
        });
    }

    // Form Submission with Dual-Check Safety Logic
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const emailInput = document.getElementById('email');
            const passwordInput = document.getElementById('password');
            if (!emailInput || !passwordInput) return;

            const email = emailInput.value.trim();
            const password = passwordInput.value;

            const btn = loginForm.querySelector('.submit-btn');
            const originalContent = btn.innerHTML;

            btn.innerHTML = `<span class="loader"></span> Autenticando...`;
            btn.disabled = true;

            console.log(`[Login] Attempting login for ${email} on app ${targetApp.id}`);

            try {
                // 1. Autenticação Primária com Timeout
                const authPromise = supabase.auth.signInWithPassword({ email, password });
                const authTimeout = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Tempo limite de login esgotado. Verifique sua conexão.')), 15000)
                );

                const { data: authData, error: authError } = await Promise.race([authPromise, authTimeout]);

                if (authError) throw authError;

                const user = authData.user;
                console.log(`[Login] Primary auth success for user ${user.id}`);

                // 2. Dual-Check (Validação Legada vs Centralizada)
                btn.innerHTML = `<span class="loader"></span> Verificando acesso...`;

                const accessTimeout = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Tempo limite na verificação de acesso.')), 10000)
                );

                // Chamadas paralelas para otimizar tempo
                const checksPromise = Promise.all([
                    supabase.from('profiles').select('role').eq('id', user.id).single(),
                    supabase.rpc('check_app_access', { p_user_id: user.id, p_app_id: targetApp.id })
                ]);

                const [legacyCheck, centralCheck] = await Promise.race([checksPromise, accessTimeout]);

                const legacyProfile = legacyCheck.data;
                const hasCentralAccess = centralCheck.data;

                console.log(`[Login] Access check results:`, { legacy: !!legacyProfile, central: !!hasCentralAccess });

                // 3. Lógica de Segurança (Audit Mode)
                const allowsLegacy = !!legacyProfile;
                const allowsCentral = !!hasCentralAccess;

                if (allowsLegacy && !allowsCentral) {
                    console.warn("MIGRAÇÃO: Usuário tem acesso legado mas não centralizado.");
                    supabase.from('app_security_audit').insert({
                        event_type: 'mismatch_detected',
                        user_id: user.id,
                        app_id: targetApp.id,
                        details: {
                            legacy_role: legacyProfile?.role,
                            central_access: false,
                            userAgent: navigator.userAgent
                        }
                    }).then(({ error }) => { if (error) console.error("Audit error:", error); });
                }

                // 4. Conclusão do Login
                if (!allowsLegacy && !allowsCentral) {
                    await supabase.auth.signOut();
                    throw new Error(`Acesso Negado: Você não tem permissão para o sistema "${targetApp.name}".`);
                }

                console.log("[Login] Redirecting to:", targetApp.url);
                btn.innerHTML = `<span class="loader"></span> Iniciando ${targetApp.name}...`;

                // Redirecionamento com sessão
                const session = authData.session;
                if (targetApp.url && session) {
                    const redirectUrl = new URL(targetApp.url);
                    redirectUrl.hash = `sso_access=${session.access_token}&sso_refresh=${session.refresh_token}`;

                    setTimeout(() => {
                        window.location.href = redirectUrl.toString();
                    }, 500);
                } else if (targetApp.url) {
                    window.location.href = targetApp.url;
                } else {
                    btn.innerHTML = `<span>Logado!</span>`;
                    alert(`Sucesso! Você agora está logado. (App: ${targetApp.name})`);
                    btn.disabled = false;
                }

            } catch (err) {
                console.error("[Login Error]", err);
                alert(err.message || "Erro ao realizar login");
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }
        });
    }
});
