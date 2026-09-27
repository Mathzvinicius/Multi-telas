# Monitoramento de Colaboradores
Visualizacao de tela em tempo real, com deteccao de atividade e apps em uso.

## Como usar

### 1) Iniciar servidor e dashboard
```bash
npm install
npm run server
```

Depois abra: http://localhost:3000/dashboard.html

### 2) Instalar agente nos colaboradores
Copie a pasta `agent` para a maquina do colaborador e execute `install.bat` como Administrador.
Ele vai instalar Node.js portable, instalar dependencias, registrar inicializacao automatica no boot e iniciar o agente invisivelmente.

Para remover, execute `uninstall.bat`.

### 3) Empacotar agente
```powershell
powershell -ExecutionPolicy Bypass -File agent/deploy.ps1 -ServerUrl http://SEU_SERVIDOR:3000 -Interval 5000
```

## Protecoes implementadas
- Inicializacao automatica no boot via tarefa agendada do Windows
- Execucao invisivel via VBScript sem janela
- Modo silencioso sem saida no console
- Reconexao automatica ao servidor
- Lock file para evitar multiplas instancias
- Tratamento de sinais para encerramento limpo
- Dependencias locais com Node.js portable

## Observacoes
- Use apenas em ambientes que voce tem autorizacao para monitorar.
- Em producao, use HTTPS, autenticacao e controle de acesso.
- Execute sempre como Administrador durante instalacao.
