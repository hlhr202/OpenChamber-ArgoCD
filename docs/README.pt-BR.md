# OpenChamber Argo CD Observer

[English](../README.md) | [简体中文](README.zh-CN.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [עברית](README.he.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | Português (Brasil) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [繁體中文](README.zh-TW.md)

Uma **extensão completa do Argo CD para o OpenChamber**. Navegue por aplicações, inspecione implantações, consulte logs e eventos de recursos e execute ações operacionais do Argo CD (Sync, Refresh, Terminate, Rollback, Resource Actions, Patch, criação, exclusão e operações de gerenciamento) diretamente no seu espaço de trabalho.

## Instalação

1. Abra **Configurações → Extensões** no OpenChamber.
2. Cole esta URL do repositório em **Pasta, ZIP ou URL** e clique em **Adicionar**:

   ```text
   https://github.com/hlhr202/OpenChamber-ArgoCD
   ```

3. Revise a capacidade Service solicitada e escolha **Permitir e ativar**.
4. Abra **Argo CD** na barra de extensões e carregue seus contextos.

Não é necessário compilar localmente nem instalar dependências.

Você também pode baixar **openchamber-argocd.zip** em [Releases](https://github.com/hlhr202/OpenChamber-ArgoCD/releases/latest) e adicionar esse ZIP em Extensões. Use o ZIP pré-compilado anexado, não o **Source code (zip)** do GitHub.

## Pré-requisitos

- **OpenChamber com suporte a extensões**, introduzido na [v1.24.0](https://github.com/openchamber/openchamber/releases/tag/v1.24.0). Esta compilação exige atualmente **v2.2.0 ou posterior** para instalação; a compatibilidade com versões anteriores não foi verificada.
- **CLI do Argo CD instalada e já configurada** para o usuário do sistema que executa o OpenChamber Server, com credenciais válidas e permissões RBAC do Argo CD para as operações de leitura e escrita necessárias. A extensão lê essa configuração e chama diretamente a API REST oficial do Argo CD; não executa a CLI nem faz login separadamente.
- O OpenChamber Server deve conseguir acessar a API do Argo CD configurada.

## Capturas de tela

Interface em inglês com dados de exemplo.

| Visão geral e ações de aplicações | Diálogo de sincronização |
| :---: | :---: |
| ![Visão geral e ações de aplicações](screenshots/01-applications-overview.png) | ![Diálogo de sincronização](screenshots/02-sync-dialog.png) |
| **Árvore e ações de recursos** | **Gerenciamento (Projetos, Clusters, Repositórios)** |
| ![Árvore e ações de recursos](screenshots/03-resource-actions.png) | ![Gerenciamento (Projetos, Clusters, Repositórios)](screenshots/04-management.png) |

## Funcionalidades

- Alternar contextos do Argo CD e pesquisar ou filtrar aplicações.
- Inspecionar configuração, status, histórico de implantações e árvores de recursos.
- Ler logs de Pods/contêineres, eventos, manifestos e diferenças.
- Executar ações operacionais do Argo CD (ativadas por padrão, governadas por RBAC e Sync Windows do Argo CD), baseadas na [CLI oficial do Argo CD](https://github.com/argoproj/argo-cd): Sync (com Prune, Dry-Run, Force, Replace, Server-Side Apply e recursos seletivos), Refresh / Hard Refresh, encerrar operação, Rollback, Resource Actions (V2 com fallback automático para V1), Patch, criação/exclusão de aplicações e recursos e gerenciamento de ApplicationSet/Project/repositórios/clusters.
- Visualizar resumos de diagnóstico e confirmar antes de adicioná-los ao chat.
- Segue o idioma e o tema do OpenChamber em 15 localidades.

## Privacidade

- Esta extensão não coleta informações pessoais nem envia dados privados aos desenvolvedores. Não contém telemetria, análise ou rastreamento.
- As credenciais locais existentes são lidas apenas para autenticar solicitações à sua API do Argo CD configurada. Credenciais, dados de aplicações, logs e eventos não são enviados a serviços de coleta dos desenvolvedores ou de terceiros.
- As preferências de navegação (diretório, contexto, identificadores de aplicação/recurso, filtros, abas e layout) são salvas no armazenamento do OpenChamber: neste dispositivo quando compatível, ou no Server conectado caso contrário. Credenciais, resultados de consultas, conteúdo de logs/eventos e prévias de resumos não são salvos ali. Restaurar seleções consulta os dados novamente; o acompanhamento de logs nunca é retomado automaticamente.
- Adicionar um resumo ao chat exige sua visualização e confirmação explícitas. Se você o enviar depois, o OpenChamber e o provedor de modelos escolhido tratarão esse conteúdo conforme suas próprias políticas.

Esta declaração cobre apenas esta extensão, não as práticas de dados do OpenChamber, Argo CD ou dos provedores de modelos.

## Licença

[MIT](../LICENSE). As dependências incluídas e o ícone do Argo mantêm suas respectivas licenças; consulte os [avisos de terceiros](../THIRD_PARTY_NOTICES.txt).
