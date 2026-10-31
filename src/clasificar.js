// Reglas por palabra clave para asignar tipo de egreso a conceptos históricos.
// El orden importa: gana la primera regla que coincide.
const REGLAS = [
  ['Rendiciones', /\brendicion/],
  ['Extracciones', /\bextraccion/],
  ['Servicio de limpieza', /\bcarola\b|servicio de limpieza/],
  ['Expensas', /\bexpensas?\b/],
  ['Alquiler', /\balquiler/],
  ['Devoluciones', /\bdevolucion/],
  ['Diligencias (tickets organismos, etc.)', /\btasas?\b|\batp\b|sellado|estampilla|edicto|boletin|\bbo\b|caja forense|correo|andreani|carta documento|cedula|ticket(s)? (de )?organismo/],
  ['Diligencias (cadete)', /diligencia|\bmiguel\b|oficios?\b|motomandado|cadete|\bhector\b/],
  ['Tóners', /\btoners?\b/],
  ['Librería', /libreria|papelera|fotocopia|impresi|impresora|resma|hojas|carpetas|sobres|sello|timbre|cinta|tijera|pilas|cable|mouse|bolsas|listas?\b|vinilo|gotita/],
  ['Servicios (luz, internet, etc.)', /\bclaro\b|\bsecheep\b|\bluz\b|internet|google|gloogle|\bclaude\b|firmador|abono agua/],
  ['Productos de limpieza y varios', /papel higienico|servilleta|insumos|limpieza|yerba|agua|bidon|cafe|azucar/],
  ['Productos de limpieza y varios', /supermercado|papel hig/],
  ['Otros', /^\s*gastos?\b|electricista|enchufe|arreglo|celular|cuadro|vianda|zapatilla/],
];

const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function clasificar(concepto) {
  const t = normalizar(concepto);
  return REGLAS.find(([, re]) => re.test(t))?.[0] ?? null;
}
