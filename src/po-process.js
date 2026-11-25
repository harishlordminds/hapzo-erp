const operation = (stage, title = stage, extra = {}) => ({ stage, title, ...extra });
const checkpoint = (material, title = material) => ({ material, title });
const substep = (title, description) => ({ title, description });

const stageSteps = {
  Spinning: [operation('Spinning'), checkpoint('Yarn', 'Greige yarn')],
  Warping: [operation('Warping'), substep('Sizing', 'Commission sizing for the warp')],
  Weaving: [operation('Weaving', 'Weaving', { input: 'Weft yarn' })],
  'Fabric dyeing': [operation('Fabric dyeing', 'Fabric dyeing', { description: 'Commission fabric dyeing' }),
    substep('Fabric printing', 'When specified for the fabric')],
  'Fabric finishing': [operation('Fabric finishing', 'Washing & finishing', { description: 'Commission washing / finishing' }), checkpoint('Finished fabric')],
  Cutting: [operation('Cutting'), substep('Cut-panel bundling', 'Cutting output')],
  Printing: [operation('Printing', 'Cut-panel printing')],
  Stitching: [operation('Stitching', 'Sewing'), substep('Trimming & finishing', 'Sewn garments ready for internal inspection')],
  'Garment QC': [operation('Garment QC', 'Internal inspection')],
  'Garment finishing': [operation('Garment finishing', 'Ironing', { description: 'Garment finishing' }), substep('Folding', 'Garment finishing')],
};

function stepsFor(stages) {
  return stages.flatMap((stage, index) => {
    if (stage === 'Fabric inspection' && stages[index - 1] !== 'Fabric finishing') {
      return [checkpoint('Finished fabric'), operation(stage)];
    }
    return Object.hasOwn(stageSteps, stage) ? stageSteps[stage] : [operation(stage)];
  });
}

const fabricPaths = [
  [
    { title: 'Fabric-dyed or printed', stages: ['Warping', 'Weaving', 'Fabric dyeing'] },
    { title: 'Yarn-dyed', stages: ['Yarn dyeing', 'Warping', 'Weaving'] },
  ],
  [
    { title: 'Fabric-dyed or printed', stages: ['Knitting', 'Fabric dyeing'] },
    { title: 'Yarn-dyed', stages: ['Yarn dyeing', 'Knitting'] },
  ],
];
const fabricSteps = new Set(fabricPaths.flatMap(paths => paths.flatMap(path => path.stages)));
const specialStages = ['Printing', 'Embroidery'];

function garmentSteps(stages, panelPrintRequired) {
  const cut = stages.indexOf('Cutting');
  const sew = stages.indexOf('Stitching');
  const special = stages.slice(cut + 1, sew);
  if (panelPrintRequired || cut < 0 || sew <= cut || special.some(stage => !specialStages.includes(stage))) return stepsFor(stages);

  const extra = specialStages.filter(stage => !stages.includes(stage)).flatMap(stage =>
    stepsFor([stage]).map(step => ({ ...step, reference: true })));
  return [
    ...stepsFor(stages.slice(0, cut + 1)),
    { title: 'Optional cut-panel processes', lanes: [
      { title: 'Special processes', steps: [
        ...stepsFor(special), ...extra, substep('Fusing', 'When specified in the tech pack'),
      ] },
      { title: 'Direct to sewing', steps: [substep('Bundled cut panels', 'When special processes are unnecessary')] },
    ] },
    ...stepsFor(stages.slice(sew)),
  ];
}

export function productionProcess(stages, { panelPrintRequired = false } = {}) {
  const start = stages.findIndex(stage => fabricSteps.has(stage));
  const finish = stages.indexOf('Fabric finishing');
  const planned = stages.slice(start, finish).join('|');
  const paths = start >= 0 && finish > start && fabricPaths.find(options =>
    options.some(path => path.stages.join('|') === planned));
  if (!paths) return garmentSteps(stages, panelPrintRequired);

  const before = stepsFor(stages.slice(0, start));
  if (before.at(-1)?.material !== 'Yarn') before.push(checkpoint('Yarn', 'Greige yarn'));
  const lanes = paths.map(path => ({
    title: path.title,
    selected: path.stages.join('|') === planned,
    steps: stepsFor(path.stages).map(step => {
      if (step.stage === 'Yarn dyeing') return { ...step, description: 'Commission yarn dyeing' };
      if (step.stage === 'Knitting') return { ...step, description: 'Commission knitting' };
      return step;
    }),
  }));
  return [...before, { title: 'Fabric processing paths', lanes },
    ...garmentSteps(stages.slice(finish), panelPrintRequired)];
}
