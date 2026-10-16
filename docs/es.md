# Zabbix

Su supervisión [Zabbix](https://www.zabbix.com/) en Gladys: cada host se
convierte en un dispositivo (disponible, problemas activos, gravedad más
alta, mantenimiento), un dispositivo «Servidor Zabbix» cuenta los problemas
por gravedad, y sus escenas reaccionan cuando un problema empieza o se
resuelve: una luz roja para un desastre, un mensaje para un disco que falla.
Una escena también puede reconocer los problemas de un host, y un widget del
panel enumera los problemas en curso.

La integración lee la API de Zabbix en su red local, con un token de API.
Nada pasa por una nube.

Probada con un Zabbix 7.0 LTS real (imágenes Docker oficiales, agente 2 y
elementos trapper), y para Zabbix 6.0 y 6.4 según las diferencias
documentadas de su API. Sus comentarios son bienvenidos:
[github.com/guim31/gladys-zabbix/issues](https://github.com/guim31/gladys-zabbix/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- Zabbix 5.4 o posterior (tokens de API), 6.0 LTS y 7.0 LTS incluidos,
  accesible desde la máquina de Gladys (la dirección de su interfaz web).
- Un usuario de Zabbix para Gladys. Basta un rol de solo lectura sobre los
  grupos de hosts que quiera seguir; añada el permiso de reconocer problemas
  para la acción de escena.

## Primeros pasos

### 1. Crear un token de API

En Zabbix, abra **Usuarios → Tokens de API** (6.4 y posteriores;
**Administración → General → Tokens de API** de la 5.4 a la 6.2), pulse
**Crear token de API**, elija el usuario, desmarque «Establecer fecha de
caducidad» o elija una fecha lejana, y copie el token: Zabbix solo lo muestra
una vez.

### 2. Configurar la integración

En Gladys, abra la configuración de la integración:

- **Dirección de Zabbix**: la dirección con la que abre la interfaz de
  Zabbix, por ejemplo `http://192.168.1.2/zabbix` o
  `https://zabbix.example.com`. También vale la dirección de una página
  copiada del navegador.
- **Token de API**: el token del paso 1.
- **Grupos de hosts (opcional)**: nombres separados por comas, escritos
  exactamente como en Zabbix (mayúsculas incluidas). Vacío: todos los hosts
  supervisados que ve el token.
- **Claves de elementos (opcional)**: hasta 5 claves de elementos numéricos,
  por ejemplo `system.cpu.util, vm.memory.utilization, vfs.fs.size[/,pused]`.
  Cada host que tenga uno de estos elementos recibe una función con su último
  valor.
- **Intervalo de actualización**: de 15 segundos a 5 minutos (30 segundos por
  defecto).
- **Permitir reconocer desde escenas**: desmarque para desactivar la acción de
  reconocimiento.
- **Aceptar certificados autofirmados**: para una dirección `https://` cuyo
  certificado tampoco reconoce su navegador.
- **Idioma de los nombres**: idioma de los nombres de las funciones y de los
  resultados de escena.

Guarde y pulse **Probar la conexión**: se muestran la versión de Zabbix, el
número de hosts y de problemas activos.

### 3. Añadir los dispositivos

Abra la pestaña **Descubrir** de la integración y añada los hosts que quiera
seguir, y el dispositivo «Servidor Zabbix» si quiere los recuentos por
gravedad. Los disparadores de escena valen para todos los hosts, añadidos a
Gladys o no.

## Los dispositivos

Cada **host** (solo hosts supervisados; los desactivados se dejan fuera):

| Función           | Valor                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| Disponible        | 1 disponible, 0 no disponible (una interfaz, o el agente activo en 7.0+)                           |
| Problemas activos | número de problemas activos (sin los suprimidos)                                                   |
| Gravedad más alta | 0 No clasificado, 1 Información, 2 Advertencia, 3 Promedio, 4 Alta, 5 Desastre, -1 ningún problema |
| En mantenimiento  | 1 durante un mantenimiento de Zabbix del host                                                      |
| Elementos         | una función por clave de elemento configurada presente en el host, con su nombre                   |

«Disponible» queda vacío para un host sin interfaz (solo elementos trapper),
cuya disponibilidad Zabbix no conoce.

El dispositivo **Servidor Zabbix**:

- Problemas activos
- Problemas no clasificados
- Problemas de información
- Problemas de advertencia
- Problemas promedio
- Problemas altos
- Problemas de desastre

Los valores solo se envían a Gladys cuando cambian, y si no, cada 6 horas.

## Panel

El widget **Problemas de Zabbix** muestra tres mosaicos (los problemas
activos, los que aún no se han reconocido, los hosts no disponibles) y luego
los problemas, los más graves primero: el problema, su host (✓ una vez
reconocido), y un icono y un color para su gravedad. Diez filas como máximo.
**Actualizar** vuelve a leer Zabbix. En sus ajustes, elija hosts para mostrar
solo los suyos (vacío: todos los hosts).

## Escenas

### Disparadores

- **Empieza un problema**: un nuevo problema en un host. Filtros: hosts
  (vacío: cualquiera), gravedades (vacío: cualquiera; para «Alta o más», elija
  Alta y Desastre). Variables: nombre del host, problema, gravedad, nivel de
  gravedad (0 a 5), id. de evento de Zabbix.
- **Se resuelve un problema**: un problema se resuelve o se cierra, con los
  mismos filtros y variables, más su duración en minutos.
- **Zabbix ya no responde**: la API no responde dos veces seguidas
  (variables: dirección de Zabbix, error).

Los problemas ya presentes al arrancar la integración no se anuncian. Un
problema que empieza o termina durante un reinicio de Gladys o de la
integración se anuncia una vez en la lectura siguiente. Los problemas
suprimidos por un mantenimiento se dejan fuera, como en los paneles de
Zabbix.

### Acciones

- **Reconocer los problemas de un host**: reconoce en Zabbix los problemas
  activos del host, con un mensaje en su historial (vacío: «Reconocido desde
  Gladys»). Devuelve el número de problemas reconocidos. Se desactiva con
  «Permitir reconocer desde escenas».
- **Leer los problemas**: cuenta y enumera los problemas activos de un host, o
  de todos, para las acciones siguientes: número, sin reconocer, gravedad más
  alta (en palabras y como nivel), y la lista «host: problema».

### Ideas de escenas

- **Una luz roja para los problemas graves**: disparador «Empieza un
  problema», gravedades Alta y Desastre → la lámpara del salón se pone roja y
  un mensaje envía `{{triggerEvent.data.host}}: {{triggerEvent.data.problem}}`.
- **Vuelta a la normalidad**: disparador «Se resuelve un problema», mismos
  filtros → mensaje «Resuelto tras {{triggerEvent.data.duration_minutes}}
  min».
- **Informe matinal**: cada día a las 8:00, «Leer los problemas» → enviar el
  número y la lista cuando el número sea mayor que 0.
- **Visto desde el sofá**: un botón del panel o un mando Zigbee lanza
  «Reconocer los problemas de un host» en el NAS.

## Solución de problemas

- **«Token de API rechazado o caducado»**: compruebe el token en Usuarios →
  Tokens de API (activado, no caducado), y que su usuario esté activado.
- **«Zabbix no responde»**: compruebe la dirección desde la máquina de
  Gladys. `localhost` es el propio contenedor de la integración: use la
  dirección IP de la máquina de Zabbix.
- **«No hay ninguna API de Zabbix en esta dirección»**: la dirección no lleva
  a la interfaz web; `api_jsonrpc.php` debe estar junto a sus páginas.
- **«Certificado rechazado»**: marque «Aceptar certificados autofirmados», o
  use la dirección `http://` en la red local.
- **«Ningún grupo de hosts con estos nombres»**: los nombres deben coincidir
  exactamente con los de Zabbix. El informe de «Probar la conexión» enumera
  los desconocidos.
- **Falta un host**: está desactivado, fuera de los grupos de hosts, o el
  usuario del token no tiene permiso para leerlo.
- **Se rechaza el reconocimiento**: el rol del usuario necesita «Reconocer
  problemas», y permiso de lectura o escritura sobre el grupo de hosts.

## Límites

- Un solo servidor Zabbix por integración.
- Solo los problemas de los disparadores de Zabbix (ni eventos internos, ni
  servicios). Los problemas suprimidos se dejan fuera.
- «Se resuelve un problema» también se activa cuando un problema sale del
  alcance: un host retirado de los grupos de hosts, un disparador desactivado.
- Como máximo 30 eventos de problema por lectura: un corte de red puede
  provocar decenas a la vez; el resto solo se registra.
- Las funciones de elementos solo contienen números; un porcentaje se muestra
  como nivel de 0 a 100, las demás unidades sin unidad.
- Sin cuota en la API de Zabbix: cada lectura envía de cuatro a seis
  peticiones.

Sin relación con Zabbix SIA. Zabbix es una marca de Zabbix SIA.
