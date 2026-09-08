import { locale } from '../i18n'

const messages = {
  help: ['起動・終了の使い方', 'Starting and stopping'],
  startHelp: ['Start-Office.cmd をダブルクリックすると起動します。', 'Double-click Start-Office.cmd to start.'],
  stopHelp: ['終了は Stop-Office.cmd、または起動画面で Ctrl+C。ブラウザを閉じるだけでは終了しません。', 'Use Stop-Office.cmd or Ctrl+C in the launcher to stop. Closing the browser does not stop the server.'],
  limitError: ['保存できませんでした。入力文字数や登録件数の上限を確認してください。', 'Could not save. Check the text and item limits.'],
  subtitle: ['あなたのAIチームと、次の一歩を。', 'Your AI team. Your next step.'],
  working: ['作業中', 'Working'], attention: ['確認が必要', 'Needs attention'], projects: ['プロジェクト', 'Projects'],
  add: ['追加', 'Add'], addProject: ['プロジェクトを追加', 'Add project'], title: ['プロジェクト名', 'Project name'],
  cancel: ['キャンセル', 'Cancel'], empty: ['まだプロジェクトはありません', 'No projects yet'],
  emptyHelp: ['やりたいことを登録して、計画やチェックリストを整理しましょう。', 'Add a project to organize your plan and checklist.'],
  manual: ['手動で管理するメモ', 'Manually managed notes'], waiting: ['接続待ち', 'Waiting for connection'],
  online: ['実際の受信状態', 'Received agent status'], staff: ['メンバーの状況', 'Team status'],
  overview: ['プロジェクト概要', 'Project overview'], description: ['説明', 'Description'], plan: ['作業計画', 'Plan'],
  save: ['保存', 'Save'], saved: ['保存しました', 'Saved'], tasks: ['タスク', 'Tasks'], taskTitle: ['新しいタスク', 'New task'],
  remove: ['削除', 'Remove'], archive: ['アーカイブ', 'Archive'], archived: ['アーカイブ済み', 'Archived'], restore: ['戻す', 'Restore'],
  backup: ['バックアップを書き出す', 'Export backup'], backupError: ['バックアップを書き出せませんでした。もう一度お試しください。', 'Export failed. Please try again.'],
  realWork: ['AIの実際の作業', 'Actual AI work'], noWork: ['AIからの状況が届くと、ここに表示します。', 'Agent updates will appear here when received.'],
  note: ['この計画を編集しても、AIへの指示は送信されません。', 'Editing this plan does not send instructions to AI.'],
  office: ['チームオフィス', 'Team office'], date: ['現在時刻', 'Current time'], noTask: ['作業内容の受信なし', 'No task detail received'],
}
export function d(key) { return messages[key]?.[locale() === 'ja' ? 0 : 1] ?? key }
