import { Tree, TreeNode } from 'react-organizational-chart';

function NodeCard({ node }) {
  return (
    <div
      className={`inline-block rounded-lg border px-3 py-2 text-left shadow-sm ${
        node.is_viewer ? 'border-brand bg-brand/10 ring-2 ring-brand/20' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="text-sm font-semibold text-ink">
        {node.full_name}
        {node.is_viewer ? (
          <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-brand">You</span>
        ) : null}
      </div>
      {node.designation ? <div className="text-xs text-slate-500">{node.designation}</div> : null}
      {node.department ? <div className="mt-0.5 text-[11px] font-medium text-brand">{node.department}</div> : null}
    </div>
  );
}

function renderNode(node) {
  return (
    <TreeNode key={node.employee_id} label={<NodeCard node={node} />}>
      {node.children.map(renderNode)}
    </TreeNode>
  );
}

export default function OrgChart({ roots }) {
  // The API returns a single root: the top of the viewer's own reporting chain, not the
  // whole company — so this renders that one chain rather than a multi-root company tree.
  if (!roots.length) return null;
  const [root] = roots;
  return (
    <div className="overflow-x-auto p-4">
      <Tree lineWidth="2px" lineColor="#cbd5e1" lineBorderRadius="6px" label={<NodeCard node={root} />}>
        {root.children.map(renderNode)}
      </Tree>
    </div>
  );
}
