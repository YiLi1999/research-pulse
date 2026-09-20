// Multi-label discovery rules, not an authoritative subject classification.
const sub = (id, label, question, pattern) => ({ id, label, question, pattern });
const mathSub = (id, label, question, codes, pattern) => ({ ...sub(id, label, question, pattern), metadata: new RegExp(`\\bmath\\.(?:${codes})\\b`) });

export const researchFields = [
  {
    id: "quantum", label: "量子计算", metadata: /quantum comput/i,
    pattern: /\b(qubits?|qldpc|stabilizer|magic states?|quantum (comput\w*|algorithms?|circuits?|simulat\w*|processors?|error correction)|fault.tolerant quantum)\b/i, requireContext: true,
    children: [
      sub("resources", "量子资源与基础", "如何量化、认证和利用非经典资源？", /\b(entanglement|bell|nonlocal\w*|contextual\w*|randomness|self.testing|device.independent|magic|nonstabilizerness|resource theor\w*)\b/i),
      sub("error-correction", "量子纠错与容错", "如何降低量子纠错与容错的资源开销？", /\b(error.correct\w*|fault.toler\w*|qldpc|ldpc|surface codes?|decoders?|logical qubits?)\b/i),
      sub("algorithms", "量子算法与复杂度", "量子算法在什么任务上具有可验证的优势？", /\b(quantum algorithms?|quantum advantage|quantum speedup|quantum computing|quantum comput\w*|variational quantum|quantum machine learning|quantum complexity|quantum circuits?)\b/i),
      sub("communication", "量子通信与网络", "如何可靠地传输量子信息并构建安全网络？", /\b(quantum communication|quantum networks?|quantum internet|key distribution|quantum cryptograph\w*|quantum repeaters?|teleportation)\b/i),
      sub("simulation", "量子模拟与态制备", "如何制备和模拟复杂量子态？", /\b(quantum simulat\w*|state preparation|quantum many.body|tensor networks?|rydberg|quantum quenches)\b/i),
      sub("hardware", "量子硬件与控制", "如何改善量子器件的相干性与控制精度？", /\b(qubits?|quantum gates?|quantum control|trapped ions?|decoherence|coherence time|quantum processors?|quantum devices?)\b/i)
    ]
  },
  {
    id: "condensed", label: "凝聚态与材料物理", metadata: /cond-mat|\bprb\b|\bprmaterials\b|condensed matter|materials/i,
    pattern: /\b(condensed matter|materials?|superconduct\w*|magnetism|spintronics|topological insulator|semiconductors?)\b/i,
    children: [
      sub("topology", "拓扑物态", "如何识别和调控拓扑相及其边界态？", /\b(topolog\w*|chern|majorana|weyl|quantum hall)\b/i),
      sub("superconductivity", "超导与强关联", "如何理解超导与强关联体系的微观机制？", /\b(superconduct\w*|strongly.correlated|hubbard|mott|cooper pair|heavy.fermion)\b/i),
      sub("magnetism", "磁性与自旋", "如何调控磁序、自旋激发和自旋输运？", /\b(magnet\w*|spintron\w*|magnon\w*|skyrmion\w*|spin liquid|antiferromagnet\w*)\b/i),
      sub("transport", "电子输运与低维体系", "低维体系中的电荷和能量如何输运？", /\b(transport|graphene|moir[eé]|two.dimensional|2d materials?|conductivity|thermoelectric|semiconduct\w*)\b/i),
      sub("materials", "材料结构与性能", "如何通过结构设计改善材料的物理性能？", /\b(materials?|crystal\w*|phonon\w*|defects?|heterostructur\w*|alloys?|ferroelectric\w*)\b/i)
    ]
  },
  {
    id: "optics", label: "光学与光子学", metadata: /physics\.optics|photonics/i,
    pattern: /\b(optic\w*|photon\w*|lasers?|cavity)\b/i,
    children: [
      sub("photonics", "光子学与光学器件", "如何提升光子器件的效率、带宽和集成能力？", /\b(photon\w*|metasurfaces?|waveguides?|lasers?|frequency conversion|nonlinear optic\w*|optical devices?)\b/i),
      sub("light-matter", "光与物质相互作用", "如何控制光与物质的耦合及非线性响应？", /\b(cavity|cavities|light.matter|polariton\w*|optomechan\w*|strong coupling|superradiance)\b/i),
      sub("atoms", "原子、分子与冷原子", "如何控制原子分子体系及其集体量子行为？", /\b(atoms?|atomic|molecul\w*|ultracold|cold atoms?|trapped ions?|bose.einstein|rydberg)\b/i),
      sub("sensing", "精密测量与传感", "如何提高测量灵敏度、精度与抗噪能力？", /\b(metrolog\w*|sensing|sensors?|interferomet\w*|atomic clocks?|precision measurement|quantum fisher)\b/i)
    ]
  },
  {
    id: "high-energy", label: "粒子、核物理与宇宙学", metadata: /hep-|nucl-|gr-qc|astro-ph|\bprd\b/i,
    pattern: /\b(particle physics|elementary particles?|collider\w*|hadron\w*|nuclear|cosmolog\w*|black holes?|gravitat\w*|dark matter)\b/i,
    children: [
      sub("particles", "粒子物理与场论", "如何检验基本相互作用并寻找新物理？", /\b(particle physics|elementary particles?|quarks?|higgs|collider\w*|standard model|field theor\w*|hadron\w*|qcd|qed|neutrino\w*)\b/i),
      sub("gravity", "引力与黑洞", "如何检验引力理论和黑洞的性质？", /\b(gravit\w*|black holes?|spacetime|space.time|relativity|holograph\w*)\b/i),
      sub("cosmology", "宇宙学与暗物质", "如何约束宇宙演化以及暗物质和暗能量？", /\b(cosmolog\w*|dark matter|dark energy|inflation|early universe|cosmic|galax\w*)\b/i),
      sub("nuclear", "核物理", "如何描述核结构和核反应中的多体动力学？", /\b(nuclear|nuclei|nucleons?|heavy.ion|neutron stars?|nucleosynthesis)\b/i)
    ]
  },
  {
    id: "statistical", label: "统计物理与复杂系统", metadata: /stat-mech|physics\.(flu-dyn|bio-ph)|\bpre\b/i,
    pattern: /\b(statistical physics|nonequilibrium|non.equilibrium|complex systems?|stochastic|fluids?|turbulen\w*|active matter)\b/i,
    children: [
      sub("nonequilibrium", "非平衡与热力学", "如何理解非平衡涨落、耗散与热力学约束？", /\b(nonequilibrium|non.equilibrium|thermodynamic\w*|entropy|dissipat\w*|fluctuation\w*)\b/i),
      sub("fluids", "流体与软物质", "如何预测复杂流动和软物质的集体响应？", /\b(fluids?|flow|turbulen\w*|soft matter|polymers?|colloid\w*|granular)\b/i),
      sub("active-matter", "活性物质与生物物理", "如何解释活性和生物体系中的集体行为？", /\b(active matter|self.propell\w*|biophys\w*|biological|flocking|microorganism\w*|cellular)\b/i),
      sub("dynamics", "非线性与复杂网络", "复杂系统中的同步、临界性和混沌如何产生？", /\b(chaos|chaotic|synchron\w*|complex networks?|criticality|percolation|nonlinear dynamics)\b/i)
    ]
  },
  {
    id: "interdisciplinary", label: "科学计算、人工智能与应用", metadata: /cs\.|physics\.comp-ph|\bprapplied\b/i,
    pattern: /\b(machine learning|neural networks?|numerical methods?|inverse design|applied physics)\b/i,
    children: [
      sub("ai", "机器学习与科学智能", "机器学习如何帮助物理建模、预测与发现？", /\b(machine learning|deep learning|neural networks?|artificial intelligence|foundation models?|diffusion models?)\b/i),
      sub("numerics", "数值计算与数学方法", "如何提高物理问题的计算精度与效率？", /\b(numerical|monte carlo|finite.element|optimization|computational|differential equations?)\b/i),
      sub("applications", "应用器件与逆向设计", "如何将物理机制转化为可用器件和设计方案？", /\b(inverse design|devices?|energy harvesting|batter\w*|acoustic\w*|piezoelectric|thermal management)\b/i)
    ]
  },
  {
    id: "quantum-information", label: "量子信息与基础", metadata: /quantum information/i,
    pattern: /\b(entanglement|nonlocality|quantum (information|communication|networks?|cryptograph\w*|resources?|foundations?)|bell (inequalit\w*|tests?)|contextuality|teleportation)\b/i, requireContext: true,
    children: [
      sub("resources", "纠缠与量子资源", "如何量化与转化量子信息资源？", /\b(entanglement|resource theor\w*|magic|nonstabilizerness|quantum coherence)\b/i),
      sub("communication", "通信、密码与网络", "如何可靠传输量子信息并保障通信安全？", /\b(quantum (communication|networks?|internet|cryptograph\w*|repeaters?)|key distribution|teleportation)\b/i),
      sub("foundations", "基础、认证与测量理论", "如何检验量子理论并认证非经典行为？", /\b(bell|nonlocal\w*|contextual\w*|self.testing|device.independent|quantum (measurement|foundations?|tomography))\b/i)
    ]
  },
  {
    id: "metrology", label: "精密测量与传感", metadata: /metrology|sensing/i,
    pattern: /\b(metrolog\w*|sensing|sensors?|interferomet\w*|atomic clocks?|optical clocks?|precision measurement|quantum fisher|magnetomet\w*|gravimet\w*)\b/i,
    children: [
      sub("quantum-sensing", "量子增强测量", "如何利用量子资源提高测量灵敏度？", /\b(quantum (sensing|metrology|fisher)|squeez\w*|shot.noise|heisenberg limit)\b/i),
      sub("clocks", "时频、干涉与基本常数", "如何提高时频基准和精密干涉的准确度？", /\b(clocks?|interferomet\w*|frequency standards?|fundamental constants?)\b/i),
      sub("sensors", "传感器与探测方法", "如何提升传感器的灵敏度与抗噪能力？", /\b(sensors?|sensing|magnetomet\w*|gravimet\w*|detection sensitivity)\b/i)
    ]
  },
  {
    id: "atomic", label: "原子分子与冷原子", metadata: /physics\.(atom-ph|chem-ph)|cond-mat\.quant-gas/i,
    pattern: /\b(atomic|atoms?|molecular physics|ultracold|cold atoms?|trapped ions?|bose.einstein|rydberg|fermi gases?)\b/i,
    children: [
      sub("gases", "超冷气体与量子多体", "如何控制超冷气体及其多体相？", /\b(ultracold|cold atoms?|bose.einstein|fermi gases?|optical lattices?)\b/i),
      sub("control", "原子分子操控", "如何制备并操控原子分子的内部与运动状态？", /\b(atomic|atoms?|molecular|trapped ions?|rydberg|laser cooling)\b/i)
    ]
  },
  {
    id: "astronomy", label: "天体物理与宇宙学", metadata: /astro-ph|astronomy|astrophysics/i,
    pattern: /\b(astrophys\w*|cosmolog\w*|galax\w*|exoplanets?|stellar|neutron stars?|cosmic|dark matter|dark energy)\b/i,
    children: [
      sub("universe", "宇宙演化与暗物质", "如何约束宇宙演化与暗物质模型？", /\b(cosmolog\w*|dark matter|dark energy|inflation|cosmic|galax\w*)\b/i),
      sub("objects", "恒星、行星与致密天体", "如何解释天体的形成、演化与辐射？", /\b(stellar|stars?|exoplanets?|black holes?|pulsars?|supernova\w*)\b/i)
    ]
  },
  {
    id: "plasma", label: "等离子体与聚变", metadata: /physics\.plasm-ph|plasma physics/i,
    pattern: /\b(plasma|tokamak|stellarator|magnetic confinement|inertial confinement|nuclear fusion)\b/i,
    children: [
      sub("fusion", "聚变与约束", "如何改善聚变等离子体的约束与稳定性？", /\b(fusion|tokamak|stellarator|confinement)\b/i),
      sub("dynamics", "等离子体波与输运", "如何理解等离子体中的波动、输运与不稳定性？", /\b(plasma|alfv[eé]n|magnetic reconnection)\b/i)
    ]
  },
  {
    id: "chemistry", label: "化学与能源研究", metadata: /chemistry|chemical physics|energy/i,
    pattern: /\b(cataly\w*|chemical reactions?|electrochem\w*|batteries|battery|photocatal\w*|hydrogen production|solar cells?)\b/i,
    children: [
      sub("reactions", "反应机理与催化", "如何揭示并调控化学反应路径？", /\b(cataly\w*|chemical reactions?|reaction mechanisms?|photocatal\w*)\b/i),
      sub("energy", "能量转换与储存", "如何提升能量转换和储存的效率与稳定性？", /\b(batter\w*|electrochem\w*|hydrogen|solar cells?|photovoltaic\w*)\b/i)
    ]
  },
  {
    id: "life-science", label: "生命科学与生物物理", metadata: /q-bio|physics\.bio-ph|biology|medicine|biophysics/i,
    pattern: /\b(biophys\w*|biolog\w*|proteins?|genom\w*|neurons?|cellular|cancer|biomolecul\w*)\b/i,
    children: [
      sub("molecular", "分子与细胞机制", "如何解释分子结构与细胞功能之间的联系？", /\b(proteins?|genom\w*|cellular|biomolecul\w*|molecular biology)\b/i),
      sub("systems", "生物系统与医学", "如何理解生物系统的集体行为与疾病机制？", /\b(biophys\w*|neurons?|cancer|disease|biological systems?)\b/i)
    ]
  },
  {
    id: 'mathematics', label: '数学', metadata: /\bmath\.[A-Z]{2}\b|mathematics|mathematical sciences/i,
    pattern: /\b(number theory|algebraic geometry|algebraic topology|differential geometry|functional analysis|commutative algebra|representation theory|combinatorics|mathematical logic|pure mathematics)\b/i,
    requireContext: true, metadataOnlyChildren: true,
    children: [
      mathSub('algebra-number', '代数与数论', '如何刻画代数结构与数论对象的性质？', 'AC|NT|RA|GR|RT|QA|KT|CT', /\b(algebra|number theor\w*|representation theor\w*|prime numbers?)\b/i),
      mathSub('geometry-topology', '几何与拓扑', '几何与拓扑结构有哪些不变量及分类规律？', 'AG|AT|DG|GT|GN|MG|SG', /\b(geometr\w*|topolog\w*|manifolds?)\b/i),
      mathSub('analysis-equations', '分析、微分方程与动力系统', '如何证明方程解的存在性、稳定性和正则性？', 'AP|CA|CV|FA|OA|SP|DS', /\b(functional analysis|differential equations?|regularity|dynamical systems?|spectral theory)\b/i),
      mathSub('probability-statistics', '概率与数理统计', '如何理解随机结构、极限定理与统计推断？', 'PR|ST', /\b(probability|stochastic|statistical inference|limit theorems?)\b/i),
      mathSub('discrete-information', '组合数学与信息论', '离散结构和信息编码有哪些极限与构造方法？', 'CO|IT', /\b(combinatorics|graph theory|coding theory|information theory)\b/i),
      mathSub('applied-numerical', '应用数学、优化与数值分析', '如何构造高效稳定的数值与优化方法？', 'NA|OC', /\b(numerical analysis|optimization|optimal control|applied mathematics)\b/i),
      mathSub('mathematical-physics', '数学物理', '如何建立并求解物理模型的数学结构？', 'MP', /\b(mathematical physics|integrable systems?)\b/i),
      mathSub('logic-foundations', '逻辑、范畴与数学基础', '如何研究形式系统、范畴结构与数学基础？', 'LO|CT|GM|HO', /\b(mathematical logic|category theory|set theory|proof theory)\b/i)
    ]
  }
];

function textOf(paper) {
  return `${paper.title || ""} ${paper.abstract || ""} ${(paper.keywords || []).join(" ")}`
    .normalize("NFKC").replace(/[‐‑‒–—−]/g, "-");
}

export function classifyPaper(paper) {
  const text = textOf(paper);
  const metadata = [paper.journal, paper.journal_display, paper.primaryCategory,
    ...(paper.categories || []), paper.extra?.section].filter(Boolean).join(" ")
    .replace(/\bmath-ph\b/g, 'math-ph math.MP').replace(/\bcs\.IT\b/g, 'cs.IT math.IT');
  return researchFields.flatMap(field => {
    // Generic words such as "decoder" also occur in classical imaging/encryption.
    if (field.requireContext && !field.pattern.test(text) && !field.metadata.test(metadata)) return [];
    const children = field.children.filter(child => child.metadata?.test(metadata) ||
      ((!field.metadataOnlyChildren || !field.metadata.test(metadata)) && child.pattern.test(text))).map(child => child.id);
    return children.length || field.pattern.test(text) || field.metadata.test(metadata)
      ? [{ id: field.id, children }] : [];
  });
}

export function validateScope(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw Object.assign(new Error("分析范围必须是大领域和小领域组成的对象。"), { statusCode: 400 });
  }
  const majorField = input.majorField ?? "";
  const minorField = input.minorField ?? "";
  const field = researchFields.find(item => item.id === majorField);
  const child = field?.children.find(item => item.id === minorField);
  if (typeof majorField !== "string" || typeof minorField !== "string" ||
      (majorField && !field) || (minorField && !child)) {
    throw Object.assign(new Error("请选择有效的大领域及其下属小领域。"), { statusCode: 400 });
  }
  return { majorField, minorField, label: child ? `${field.label} / ${child.label}` : field?.label || "全部领域" };
}
