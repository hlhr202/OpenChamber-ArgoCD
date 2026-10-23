# OpenChamber Argo CD Observer

[English](../README.md) | [简体中文](README.zh-CN.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | Español | [Français](README.fr.md) | [עברית](README.he.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (Brasil)](README.pt-BR.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [繁體中文](README.zh-TW.md)

Una **extensión de Argo CD de solo lectura para OpenChamber**. Explora aplicaciones, inspecciona despliegues y consulta registros y eventos de recursos sin salir de tu espacio de trabajo.

## Instalación

1. Abre **Configuración → Extensiones** en OpenChamber.
2. Pega esta URL del repositorio en **Carpeta, ZIP o URL** y pulsa **Añadir**:

   ```text
   https://github.com/hlhr202/OpenChamber-ArgoCD
   ```

3. Revisa la capacidad Service solicitada y elige **Permitir y habilitar**.
4. Abre **Argo CD** desde la barra de extensiones y carga tus contextos.

No se requiere compilar localmente ni instalar dependencias.

También puedes descargar **openchamber-argocd.zip** desde [Releases](https://github.com/hlhr202/OpenChamber-ArgoCD/releases/latest) y añadir ese ZIP en Extensiones. Usa el ZIP precompilado adjunto, no **Source code (zip)** de GitHub.

## Requisitos previos

- **OpenChamber compatible con extensiones**, introducidas en [v1.24.0](https://github.com/openchamber/openchamber/releases/tag/v1.24.0). Esta compilación exige actualmente **v2.2.0 o posterior** para instalarse; no se ha verificado la compatibilidad con versiones anteriores.
- **CLI de Argo CD instalada y ya configurada** para el usuario del sistema que ejecuta OpenChamber Server, con credenciales válidas y permisos para leer las aplicaciones, recursos, registros y eventos necesarios. La extensión lee esa configuración; no ejecuta la CLI ni inicia sesión por separado.
- OpenChamber Server debe poder acceder a la API de Argo CD configurada.

## Capturas de pantalla

Interfaz en inglés con datos de ejemplo.

**Escritorio — lista de aplicaciones y vista general**

![Lista de aplicaciones de Argo CD y vista general en escritorio](applications-desktop.png)

**Móvil — lista de aplicaciones**

![Lista de aplicaciones de Argo CD en móvil](applications-mobile.png)

## Funciones

- Cambiar contextos de Argo CD y buscar o filtrar aplicaciones.
- Inspeccionar configuración, estado, historial de despliegues y árboles de recursos.
- Leer registros de Pods/contenedores, eventos, manifiestos y diferencias.
- Previsualizar resúmenes de diagnóstico y confirmar antes de añadirlos al chat.
- Solo lectura por diseño; sigue el idioma y el tema de OpenChamber.

## Privacidad

- Esta extensión no recopila información personal ni comunica datos privados a sus desarrolladores. No contiene telemetría, análisis ni seguimiento.
- Las credenciales locales existentes se leen solo para autenticar solicitudes a tu API de Argo CD configurada. Las credenciales, datos de aplicaciones, registros y eventos no se suben a servicios de recopilación de los desarrolladores ni de terceros.
- Las preferencias de navegación (directorio, contexto, identificadores de aplicación/recurso, filtros, pestañas y diseño) se guardan en el almacenamiento de OpenChamber: en este dispositivo si es compatible, o en el Server conectado en caso contrario. Allí no se guardan credenciales, resultados de consultas, contenido de registros/eventos ni vistas previas de resúmenes. Restaurar selecciones vuelve a consultar los datos; el seguimiento de registros nunca se reanuda automáticamente.
- Añadir un resumen al chat requiere tu previsualización y confirmación explícitas. Si después lo envías, OpenChamber y el proveedor de modelos elegido procesan ese contenido según sus propias políticas.

Esta declaración solo cubre esta extensión, no las prácticas de datos de OpenChamber, Argo CD ni los proveedores de modelos.

## Licencia

[MIT](../LICENSE). Las dependencias incluidas y el icono de Argo conservan sus respectivas licencias; consulta los [avisos de terceros](../THIRD_PARTY_NOTICES.txt).
