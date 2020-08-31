/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { viewColumnToEditorGroup } from 'vs/workbench/api/common/shared/editor';
import { ActiveEditorContext } from 'vs/workbench/common/editor';
import { CellDiffViewModel } from 'vs/workbench/contrib/notebook/browser/diff/celllDiffViewModel';
import { NotebookTextDiffEditor } from 'vs/workbench/contrib/notebook/browser/diff/notebookTextDiffEditor';
import { NotebookDiffEditorInput } from 'vs/workbench/contrib/notebook/browser/notebookDiffEditorInput';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

// ActiveEditorContext.isEqualTo(SearchEditorConstants.SearchEditorID)

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'notebook.diff.switchToText',
			icon: { id: 'codicon/file-code' },
			title: { value: localize('notebook.diff.switchToText', "Open Text Diff Editor"), original: 'Open Text Diff Editor' },
			precondition: ActiveEditorContext.isEqualTo(NotebookTextDiffEditor.ID),
			menu: [{
				id: MenuId.EditorTitle,
				group: 'navigation',
				when: ActiveEditorContext.isEqualTo(NotebookTextDiffEditor.ID)
			}]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const editorGroupService = accessor.get(IEditorGroupsService);

		const activeEditor = editorService.activeEditorPane;
		if (activeEditor && activeEditor instanceof NotebookTextDiffEditor) {
			const leftResource = (activeEditor.input as NotebookDiffEditorInput).originalResource;
			const rightResource = (activeEditor.input as NotebookDiffEditorInput).resource;
			const options = {
				preserveFocus: false
			};

			const label = localize('diffLeftRightLabel', "{0} ⟷ {1}", leftResource.toString(true), rightResource.toString(true));

			await editorService.openEditor({ leftResource, rightResource, label, options }, viewColumnToEditorGroup(editorGroupService, undefined));
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: 'notebook.diff.cell.revertMetadata',
				title: localize('notebook.diff.cell.revertMetadata', "Revert Metadata"),
				icon: { id: 'codicon/discard' },
				f1: false,
				menu: {
					id: MenuId.NotebookDiffCellMetadataTitle
				}
			}
		);
	}
	run(accessor: ServicesAccessor, context?: { cell: CellDiffViewModel }) {
		if (!context) {
			return;
		}

		const original = context.cell.original;
		const modified = context.cell.modified;

		if (!original || !modified) {
			return;
		}

		modified.metadata = original.metadata;
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: 'notebook.diff.cell.revertOutputs',
				title: localize('notebook.diff.cell.revertOutputs', "Revert Outputs"),
				icon: { id: 'codicon/discard' },
				f1: false,
				menu: {
					id: MenuId.NotebookDiffCellOutputsTitle
				}
			}
		);
	}
	run(accessor: ServicesAccessor, context?: { cell: CellDiffViewModel }) {
		if (!context) {
			return;
		}

		const original = context.cell.original;
		const modified = context.cell.modified;

		if (!original || !modified) {
			return;
		}

		modified.spliceNotebookCellOutputs([[0, modified.outputs.length, original.outputs]]);
	}
});
