# Guia de Integração de Colaboradores Administrativos

Este documento descreve o procedimento padrão para cadastrar e conceder acesso a novos membros da equipe administrativa (não-professores) no ecossistema Rock (BD_Geral). O fluxo de **Dual-Check Safety Logic** exige a precisão destes passos para que o login centralizado e os acessos sejam bem-sucedidos.

## Fluxo de Trabalho

A integração consiste em 5 etapas principais que garantem a autenticação, a identificação funcional e as permissões de acesso aos aplicativos.

---

### 1. Criação da Conta (Supabase Auth)
O e-mail do colaborador deve ser cadastrado no painel de Autenticação do Supabase.
- **ID do Usuário (UID):** Localize e copie o UUID gerado pelo Supabase para este e-mail. Este ID será referenciado abaixo como `USER_ID`.

### 2. Cadastro Funcional (`app_administrativo`)
Insira o nome e e-mail do colaborador na tabela do setor administrativo. Diferente de professores (que vão para `app_teachers`), colaboradores operacionais são gerenciados por esta tabela.
```sql
INSERT INTO app_administrativo (name, email, ativo) 
VALUES ('Nome do Colaborador', 'email@rock.com', true) 
RETURNING id;
```
- **ID Administrativo:** Anote o UUID retornado (`ADMIN_ID`).

### 3. Configuração do Perfil (`profiles`)
Vincule o usuário ao papel global administrativo e ao seu registro funcional criado na etapa anterior.
```sql
UPDATE profiles 
SET 
  role = 'admin', 
  admin_id = 'ADMIN_ID' -- UUID obtido no passo 2
WHERE id = 'USER_ID'; -- UUID obtido no passo 1
```

### 4. Registro de Compatibilidade (`app_users`)
Para garantir integridade histórica e retrocompatibilidade com os sistemas de gestão legados, crie o registro correspondente.
```sql
INSERT INTO app_users (id, role, teacher_id)
VALUES ('USER_ID', 'admin', null)
ON CONFLICT (id) DO UPDATE SET role = 'admin', teacher_id = null;
```

### 5. Permissões de Apps (`central_permissions`)
Conceda acesso aos aplicativos que o colaborador administrativo precisará operar (ex: `rockpg-turmas-v3`, `rock-portal-v1`).
Para a Gestão de Turmas v3 (`rockpg-turmas-v3`), a role `Adim` é geralmente utilizada para conceder capacidades totais (criar turmas, deletar registros, ver relatórios).

```sql
INSERT INTO central_permissions (user_id, app_id, role, active)
VALUES 
    ('USER_ID', 'rock-portal-v1', 'Adim', true),
    ('USER_ID', 'rockpg-turmas-v3', 'Adim', true)
ON CONFLICT (user_id, app_id) 
DO UPDATE SET active = true, role = EXCLUDED.role;
```

> [!NOTE]
> Dependendo do sistema frontend de destino (ex: `rockpg-turmas-v3`), pode ser necessário realizar um Pull Request para adicionar o e-mail do novo administrador na constante whitelist `AUTHORIZED_EMAILS` (em `usePermissions.ts`) caso o aplicativo possua um fallback de segurança extra em seu código.

---

## Verificação Final
Após executar os scripts, o colaborador administrativo deve:
1. Acessar a URL do Portal Unificado de Login.
2. Fazer login com suas credenciais.
3. Confirmar que é redirecionado corretamente e consegue visualizar seus dados e editar funcionalidades sem bloqueios (como o ícone de cadeado).
