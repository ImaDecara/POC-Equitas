import { initializeDb, deleteDb, clearLogs, overview, entityNames, listEntity, executionList, executionTree, runCase, exclusive } from '../../../src/server/poc';

// Fuerza a que esta ruta se ejecute en el runtime de Node.js (no en Edge),
// necesario para usar Buffer, variables de entorno y acceso a la base de datos.
export const runtime = 'nodejs';

// Ruta de API única para el POC local. El navegador nunca accede directamente
// a la base de datos: todo pasa por este servidor.

// Respuesta de error estándar: devuelve un JSON con el mensaje y HTTP 400.
function errorResponse(error: unknown) {
  return Response.json({error: error instanceof Error ? error.message : 'Unexpected error'}, {status: 400});
}

// Protección de las operaciones de administración (todas las que usan POST).
// 1) En producción quedan bloqueadas, salvo que ENABLE_POC_ADMIN sea 'true'.
// 2) El cliente debe enviar el header 'x-poc-token' con el mismo valor
//    que la variable de entorno POC_ADMIN_TOKEN; si no, se rechaza la petición.
function protect(req: Request) {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_POC_ADMIN !== 'true') throw new Error('POC administration is disabled in production');
  const token = process.env.POC_ADMIN_TOKEN;
  if (!token || req.headers.get('x-poc-token') !== token) throw new Error('Invalid administration token');
}


// Comprueba que el servidor Apache Hop (herramienta ETL) está accesible.
async function hopStatus() {
  // La URL del servidor viene de la configuración (variable de entorno)
  const raw = process.env.HOP_SERVER_URL;
  if (!raw) throw new Error('HOP_SERVER_URL is not configured');
  const url = new URL(raw);
  // Solo se aceptan http/https, para evitar otros protocolos no deseados
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported Hop URL');
  const username = process.env.HOP_USERNAME || '';
  const password = process.env.HOP_PASSWORD || '';
  const headers: Record<string, string> = {};
  // Si hay usuario configurado, se autentica con Basic Auth (usuario:contraseña en base64)
  if (username) headers.Authorization = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
  // Consulta el endpoint de estado de Hop, sin caché y con timeout de 5 segundos
  const response = await fetch(new URL('/hop/status/?json=Y', url), {headers, cache:'no-store', signal:AbortSignal.timeout(5000)});
  if (!response.ok) throw new Error('Apache Hop returned HTTP ' + response.status);
  return {connected:true, message:'Apache Hop connection successful'};
}

// GET: operaciones de solo lectura (consultas). No requieren token.
// La operación se elige con el parámetro de la URL ?action=...
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    switch (url.searchParams.get('action')) {
      // Resumen general del estado del POC
      case 'status': return Response.json(await overview());
      // Lista los registros de una entidad. El nombre se valida contra una
      // lista blanca (entityNames) para evitar consultar entidades no permitidas.
      case 'entities': {
        const name = url.searchParams.get('name');
        if (!entityNames.includes(name as typeof entityNames[number])) throw new Error('Invalid entity name');
        return Response.json(await listEntity(name as typeof entityNames[number]));
      }
      // Lista de ejecuciones realizadas
      case 'executions': return Response.json(await executionList());
      // Detalle de una ejecución concreta en forma de árbol (requiere ?id=...)
      case 'execution': {
        const id = url.searchParams.get('id');
        if (!id) throw new Error('Execution ID is required');
        return Response.json(await executionTree(id));
      }
      default: throw new Error('Unknown action');
    }
  } catch (error) {return errorResponse(error);}
}

// POST: operaciones que modifican datos o administran el sistema.
// Todas pasan primero por protect() (token + bloqueo en producción).
export async function POST(req: Request) {
  try {
    protect(req);
    const action = new URL(req.url).searchParams.get('action');
    // Prueba de conexión con Apache Hop (no necesita body ni exclusión)
    if (action === 'hop') return Response.json(await hopStatus());
    const body = await req.json().catch(() => ({}));
    // exclusive() garantiza que solo se ejecute una operación a la vez
    // (evita que, por ejemplo, se borre la BD mientras se ejecuta un caso).
    return Response.json(await exclusive(async () => {
      switch (action) {
        // Crea/inicializa la base de datos del POC
        case 'initialize': return initializeDb();
        // Borra la base de datos: exige una frase de confirmación exacta
        // en el body como medida de seguridad contra borrados accidentales.
        case 'delete':
          if (body.confirm !== 'DELETE POC DATABASE') throw new Error('Deletion confirmation required');
          return deleteDb();
        // Limpia los registros de log
        case 'clear-logs': return clearLogs();
        // Ejecuta un caso de prueba identificado por su caseId
        case 'run-case': return runCase(Number(body.caseId));
        default: throw new Error('Unknown action');
      }
    }));
  } catch (error) {return errorResponse(error);}
}